import { Dictionary } from "../shared/dictionary";
import {
  applyExchange, applyPass, applyPlay, applyResign, createGame, MoveError,
  type GameState, type Move, viewFor,
} from "../shared/engine";
import {
  answerDraw, answerTakeback, applyChessMove, ChessError, chessViewFor, colorOf, createChessGame,
  CPU_LEVELS, describeChessEnd, isCpu, offerDraw, other, requestTakeback, resign, sideId, sideOf,
  turnOf, type ChessState, type Color, type Side,
} from "../shared/chess";
import { sendPush, type VapidKeys } from "./webpush";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

interface Player { id: string; name: string; token: string }

const APP_NAME = "Sarathys' Game Room";
const SHORT_NAME = "Game Room";
const WORDS_PATH = "/words-v1.txt";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ------------------------------------------------------------------ helpers

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const rng = (n: number) => {
  // Unbiased random integer in [0, n) from crypto.
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < max) return buf[0] % n;
  }
};

function randomId(bytes = 9): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function body<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, "Invalid request body."); }
}

let dictPromise: Promise<Dictionary> | null = null;
function getDictionary(env: Env, reqUrl: string): Promise<Dictionary> {
  if (!dictPromise) {
    dictPromise = env.ASSETS.fetch(new URL(WORDS_PATH, reqUrl).toString())
      .then((r) => { if (!r.ok) throw new Error(`word list: ${r.status}`); return r.text(); })
      .then((t) => new Dictionary(t))
      .catch((e) => { dictPromise = null; throw e; });
  }
  return dictPromise;
}

async function authPlayer(req: Request, env: Env): Promise<Player> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Missing personal link.");
  const p = await env.DB.prepare("SELECT id, name, token FROM players WHERE token = ?").bind(token).first<Player>();
  if (!p) throw new HttpError(401, "This personal link is not valid. Ask for a new one.");
  return p;
}

function requireAdmin(req: Request, env: Env) {
  if (!env.ADMIN_KEY) throw new HttpError(503, "ADMIN_KEY is not configured on the server.");
  if (req.headers.get("x-admin-key") !== env.ADMIN_KEY) throw new HttpError(403, "Wrong admin key.");
}

interface GameRow { id: string; state: string; version: number; status: string; updated_at: number; kind?: string }

async function loadGame(env: Env, id: string): Promise<GameRow> {
  const row = await env.DB.prepare("SELECT id, state, version, status, updated_at FROM games WHERE id = ?")
    .bind(id).first<GameRow>();
  if (!row) throw new HttpError(404, "Game not found.");
  return row;
}

function vapid(env: Env, origin: string): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || origin };
}

async function notify(
  env: Env, origin: string, playerIds: string[],
  build: (p: Player) => { title: string; body: string; url: string; tag: string },
) {
  const keys = vapid(env, origin);
  if (!keys || playerIds.length === 0) return;
  const marks = playerIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT s.endpoint, s.p256dh, s.auth, p.id, p.name, p.token
       FROM push_subscriptions s JOIN players p ON p.id = s.player_id
      WHERE s.player_id IN (${marks})`,
  ).bind(...playerIds).all<{ endpoint: string; p256dh: string; auth: string } & Player>();
  await Promise.all(results.map(async (r) => {
    try {
      const res = await sendPush(r, build(r), keys);
      if (res.gone) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(r.endpoint).run();
    } catch (e) {
      console.error("push failed", e);
    }
  }));
}

function describeMove(g: GameState, m: Move): string {
  const who = g.names[m.seat];
  switch (m.kind) {
    case "play": {
      const main = m.words?.[0]?.w ?? "";
      return `${who} played ${main} for ${m.score}${m.bingo ? " (all 7 tiles!)" : ""}.`;
    }
    case "exchange": return `${who} swapped ${m.count} tile${m.count === 1 ? "" : "s"}.`;
    case "pass": return `${who} passed.`;
    case "resign": return `${who} left the game.`;
  }
}

function gameLabel(g: GameState, forPlayer: string): string {
  const others = g.names.filter((_, i) => g.seats[i] !== forPlayer);
  return `with ${others.join(" & ")}`;
}

function chessSummary(row: GameRow, g: ChessState, playerId: string) {
  const mine = colorOf(g, playerId);
  const turn = turnOf(g);
  const last = g.moves[g.moves.length - 1];
  const lastBy = last ? sideOf(g, g.moves.length % 2 === 1 ? "w" : "b").name : "";
  const opp = mine ? sideOf(g, other(mine)) : g.black;
  return {
    id: row.id,
    kind: "chess" as const,
    status: g.status,
    updatedAt: row.updated_at,
    opponent: opp.name,
    myColor: mine,
    myTurn: g.status === "active" && turn === mine,
    turnName: sideOf(g, turn).name,
    cpuTurn: g.status === "active" && isCpu(sideOf(g, turn)),
    moveNumber: Math.floor(g.moves.length / 2) + 1,
    lastMove: last ? `${lastBy} played ${last.san}` : null,
    result: g.result ?? null,
    endText: g.status === "finished" ? describeChessEnd(g) : null,
    pending: g.drawOffer && g.drawOffer !== mine ? "draw" : g.takeback && g.takeback !== mine ? "takeback" : null,
  };
}

function summary(row: GameRow, playerId: string) {
  const parsed = JSON.parse(row.state) as GameState | ChessState;
  if ((parsed as ChessState).kind === "chess") return chessSummary(row, parsed as ChessState, playerId);
  const g = parsed as GameState;
  const last = g.moves[g.moves.length - 1];
  const mySeat = g.seats.indexOf(playerId);
  return {
    id: row.id,
    kind: "words" as const,
    status: g.status,
    updatedAt: row.updated_at,
    players: g.seats.map((id, i) => ({ id, name: g.names[i], score: g.scores[i], resigned: g.resigned[i] })),
    turn: g.turn,
    myTurn: g.status === "active" && g.turn === mySeat,
    lastMove: last ? describeMove(g, last) : null,
    winners: g.end?.winners ?? [],
    bagCount: g.bag.length,
  };
}

// ------------------------------------------------------------------ routes

async function handleApi(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const origin = url.origin;

  // --- public
  if (path === "/api/push/key" && method === "GET") {
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  }
  let m = /^\/api\/manifest\/([\w-]+)$/.exec(path);
  if (m && method === "GET") {
    return new Response(JSON.stringify({
      name: APP_NAME,
      short_name: SHORT_NAME,
      start_url: `/p/${m[1]}`,
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f6efe3",
      theme_color: "#7a2e1f",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
  }

  // --- admin
  if (path === "/api/admin/players") {
    requireAdmin(req, env);
    if (method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name, token FROM players ORDER BY created_at").all<Player>();
      return json({ players: results.map((p) => ({ ...p, link: `${origin}/p/${p.token}` })) });
    }
    if (method === "POST") {
      const { name } = await body<{ name?: string }>(req);
      const clean = String(name ?? "").trim().slice(0, 30);
      if (!clean) throw new HttpError(400, "Name is required.");
      const p = { id: randomId(), name: clean, token: randomId(24) };
      try {
        await env.DB.prepare("INSERT INTO players (id, name, token, created_at) VALUES (?, ?, ?, ?)")
          .bind(p.id, p.name, p.token, Date.now()).run();
      } catch {
        throw new HttpError(409, "A player with that name already exists.");
      }
      return json({ player: { ...p, link: `${origin}/p/${p.token}` } }, 201);
    }
  }
  m = /^\/api\/admin\/players\/([\w-]+)\/reset-link$/.exec(path);
  if (m && method === "POST") {
    requireAdmin(req, env);
    const token = randomId(24);
    const r = await env.DB.prepare("UPDATE players SET token = ? WHERE id = ?").bind(token, m[1]).run();
    if (!r.meta.changes) throw new HttpError(404, "Player not found.");
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE player_id = ?").bind(m[1]).run();
    return json({ link: `${origin}/p/${token}` });
  }

  // --- player
  const me = await authPlayer(req, env);

  if (path === "/api/me" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT g.id, g.state, g.version, g.status, g.updated_at, g.kind
         FROM games g JOIN game_players gp ON gp.game_id = g.id
        WHERE gp.player_id = ?
        ORDER BY g.updated_at DESC LIMIT 50`,
    ).bind(me.id).all<GameRow>();
    const others = await env.DB.prepare("SELECT id, name FROM players WHERE id != ? ORDER BY name")
      .bind(me.id).all<{ id: string; name: string }>();
    return json({
      me: { id: me.id, name: me.name },
      family: others.results,
      games: results.map((r) => summary(r, me.id)),
    });
  }

  if (path === "/api/games" && method === "POST") {
    const { playerIds } = await body<{ playerIds?: string[] }>(req);
    const ids = [...new Set([me.id, ...(playerIds ?? [])])];
    if (ids.length < 2 || ids.length > 4) throw new HttpError(400, "Pick 1 to 3 other players.");
    const marks = ids.map(() => "?").join(",");
    const { results: players } = await env.DB.prepare(`SELECT id, name FROM players WHERE id IN (${marks})`)
      .bind(...ids).all<{ id: string; name: string }>();
    if (players.length !== ids.length) throw new HttpError(400, "Unknown player.");
    const g = createGame(players, rng);
    const id = randomId(8);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO games (id, state, version, status, created_by, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)")
        .bind(id, JSON.stringify(g), g.status, me.id, now, now),
      ...g.seats.map((pid, seat) =>
        env.DB.prepare("INSERT INTO game_players (game_id, player_id, seat) VALUES (?, ?, ?)").bind(id, pid, seat)),
    ]);
    ctx.waitUntil(notify(env, origin, g.seats.filter((p) => p !== me.id), (p) => ({
      title: `New game ${gameLabel(g, p.id)}`,
      body: g.seats[g.turn] === p.id
        ? `${me.name} started a game. You go first!`
        : `${me.name} started a game. ${g.names[g.turn]} goes first.`,
      url: `/p/${p.token}/g/${id}`,
      tag: `game-${id}`,
    })));
    return json({ id }, 201);
  }

  m = /^\/api\/games\/([\w-]+)$/.exec(path);
  if (m && method === "GET") {
    const row = await loadGame(env, m[1]);
    const since = url.searchParams.get("since");
    if (since !== null && Number(since) === row.version) return json({ unchanged: true, version: row.version });
    const g = JSON.parse(row.state) as GameState;
    if ((g as unknown as ChessState).kind === "chess") throw new HttpError(404, "Game not found.");
    if (!g.seats.includes(me.id)) throw new HttpError(403, "You are not in this game.");
    return json(viewFor(g, me.id, row.id, row.version));
  }

  m = /^\/api\/games\/([\w-]+)\/move$/.exec(path);
  if (m && method === "POST") {
    const input = await body<{
      version?: number; action?: string;
      tiles?: { r: number; c: number; l: string; b?: boolean }[]; letters?: string[];
    }>(req);
    const row = await loadGame(env, m[1]);
    const g = JSON.parse(row.state) as GameState;
    if ((g as unknown as ChessState).kind === "chess") throw new HttpError(404, "Game not found.");
    const seat = g.seats.indexOf(me.id);
    if (seat < 0) throw new HttpError(403, "You are not in this game.");
    if (typeof input.version === "number" && input.version !== row.version) {
      throw new HttpError(409, "The game changed since you loaded it. Refreshing...");
    }
    const prevTurn = g.turn;
    let move: Move;
    switch (input.action) {
      case "play": {
        if (!Array.isArray(input.tiles)) throw new HttpError(400, "No tiles.");
        const dict = await getDictionary(env, req.url);
        move = applyPlay(g, seat, input.tiles, { isWord: (w) => dict.has(w) });
        break;
      }
      case "exchange":
        move = applyExchange(g, seat, Array.isArray(input.letters) ? input.letters : [], rng);
        break;
      case "pass": move = applyPass(g, seat); break;
      case "resign": move = applyResign(g, seat); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    const now = Date.now();
    const res = await env.DB.prepare(
      "UPDATE games SET state = ?, version = version + 1, status = ?, updated_at = ? WHERE id = ? AND version = ?",
    ).bind(JSON.stringify(g), g.status, now, row.id, row.version).run();
    if (!res.meta.changes) throw new HttpError(409, "Someone else moved at the same time. Refreshing...");

    const text = describeMove(g, move);
    if (g.status === "finished") {
      const winners = g.end!.winners.map((s) => g.names[s]).join(" & ");
      ctx.waitUntil(notify(env, origin, g.seats.filter((p) => p !== me.id), (p) => ({
        title: `Game over ${gameLabel(g, p.id)}`,
        body: `${text} ${winners} won!`,
        url: `/p/${p.token}/g/${row.id}`,
        tag: `game-${row.id}`,
      })));
    } else if (g.turn !== prevTurn && g.seats[g.turn] !== me.id) {
      const nextId = g.seats[g.turn];
      ctx.waitUntil(notify(env, origin, [nextId], (p) => ({
        title: `Your turn ${gameLabel(g, p.id)}`,
        body: text,
        url: `/p/${p.token}/g/${row.id}`,
        tag: `game-${row.id}`,
      })));
    }
    return json(viewFor(g, me.id, row.id, row.version + 1));
  }

  if (path.startsWith("/api/chess")) return handleChess(req, env, ctx, url, me);

  // Lets the client preview words without shipping the full list (fallback path).
  if (path === "/api/words/check" && method === "POST") {
    const { words } = await body<{ words?: string[] }>(req);
    const dict = await getDictionary(env, req.url);
    const list = (words ?? []).slice(0, 20).map((w) => String(w));
    return json({ invalid: list.filter((w) => !dict.has(w)) });
  }

  if (path === "/api/push/subscribe" && method === "POST") {
    const sub = await body<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>(req);
    if (!sub.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new HttpError(400, "Invalid subscription.");
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET player_id = excluded.player_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).bind(sub.endpoint, me.id, sub.keys.p256dh, sub.keys.auth, Date.now()).run();
    return json({ ok: true });
  }

  if (path === "/api/push/test" && method === "POST") {
    if (!vapid(env, origin)) throw new HttpError(503, "Notifications are not configured on the server.");
    await notify(env, origin, [me.id], (p) => ({
      title: "Notifications are on",
      body: `You'll hear from ${SHORT_NAME} when it's your turn, ${p.name}.`,
      url: `/p/${p.token}`,
      tag: "test",
    }));
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found.");
}

// ------------------------------------------------------------------ chess

const CHESS_ACTIONS = [
  "move", "cpu-move", "resign", "offer-draw", "accept-draw", "decline-draw",
  "takeback", "accept-takeback", "decline-takeback",
] as const;
type ChessAction = (typeof CHESS_ACTIONS)[number];

async function handleChess(req: Request, env: Env, ctx: ExecutionContext, url: URL, me: Player): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const origin = url.origin;

  if (path === "/api/chess" && method === "POST") {
    const input = await body<{ opponentId?: string; cpuLevel?: number; color?: "w" | "b" | "random" }>(req);
    const meSide: Side = { id: me.id, name: me.name };
    let opp: Side;
    if (input.cpuLevel !== undefined) {
      const level = Number(input.cpuLevel);
      if (!CPU_LEVELS.includes(level as (typeof CPU_LEVELS)[number])) throw new HttpError(400, "Pick a level from 1 to 8.");
      opp = { cpu: level, name: `Computer (level ${level})` };
    } else {
      if (!input.opponentId || input.opponentId === me.id) throw new HttpError(400, "Pick an opponent.");
      const p = await env.DB.prepare("SELECT id, name FROM players WHERE id = ?").bind(input.opponentId)
        .first<{ id: string; name: string }>();
      if (!p) throw new HttpError(400, "Unknown player.");
      opp = { id: p.id, name: p.name };
    }
    const myColor: Color = input.color === "w" || input.color === "b" ? input.color : rng(2) === 0 ? "w" : "b";
    const g = createChessGame(myColor === "w" ? meSide : opp, myColor === "w" ? opp : meSide);
    const id = randomId(8);
    const now = Date.now();
    const humans = [g.white, g.black].map(sideId).filter((x): x is string => !!x);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO games (id, state, version, status, created_by, created_at, updated_at, kind) VALUES (?, ?, 0, ?, ?, ?, ?, 'chess')")
        .bind(id, JSON.stringify(g), g.status, me.id, now, now),
      ...humans.map((pid, seat) =>
        env.DB.prepare("INSERT INTO game_players (game_id, player_id, seat) VALUES (?, ?, ?)").bind(id, pid, seat)),
    ]);
    if (!isCpu(opp)) {
      const oppColor = other(myColor);
      ctx.waitUntil(notify(env, origin, [opp.id], (p) => ({
        title: `New chess game with ${me.name}`,
        body: oppColor === "w" ? "You play White, so it's your move." : `You play Black. ${me.name} moves first.`,
        url: `/p/${p.token}/c/${id}`,
        tag: `chess-${id}`,
      })));
    }
    return json({ id }, 201);
  }

  let m = /^\/api\/chess\/([\w-]+)$/.exec(path);
  if (m && method === "GET") {
    const row = await loadGame(env, m[1]);
    const since = url.searchParams.get("since");
    if (since !== null && Number(since) === row.version) return json({ unchanged: true, version: row.version });
    const g = JSON.parse(row.state) as ChessState;
    if (g.kind !== "chess") throw new HttpError(404, "Game not found.");
    if (!colorOf(g, me.id)) throw new HttpError(403, "You are not in this game.");
    return json(chessViewFor(g, me.id, row.id, row.version));
  }

  m = /^\/api\/chess\/([\w-]+)\/action$/.exec(path);
  if (m && method === "POST") {
    const input = await body<{ version?: number; action?: ChessAction; uci?: string }>(req);
    const row = await loadGame(env, m[1]);
    const g = JSON.parse(row.state) as ChessState;
    if (g.kind !== "chess") throw new HttpError(404, "Game not found.");
    const color = colorOf(g, me.id);
    if (!color) throw new HttpError(403, "You are not in this game.");
    if (typeof input.version === "number" && input.version !== row.version) {
      throw new HttpError(409, "The game changed since you loaded it. Refreshing...");
    }
    const oppSide = sideOf(g, other(color));
    const oppId = sideId(oppSide);
    let note: { title: string; body: string } | null = null;
    switch (input.action) {
      case "move": {
        const mv = applyChessMove(g, color, String(input.uci ?? ""));
        note = { title: `Your move vs ${me.name}`, body: `${me.name} played ${mv.san}.` };
        break;
      }
      case "cpu-move": {
        // The human's browser runs the engine and submits the computer's move.
        if (!isCpu(oppSide)) throw new HttpError(400, "Not a game against the computer.");
        applyChessMove(g, other(color), String(input.uci ?? ""));
        break;
      }
      case "resign":
        resign(g, color);
        break;
      case "offer-draw":
        offerDraw(g, color);
        if (g.status === "active") note = { title: `Draw offer from ${me.name}`, body: "Open the game to accept or decline." };
        break;
      case "accept-draw": answerDraw(g, color, true); break;
      case "decline-draw":
        answerDraw(g, color, false);
        note = { title: `${me.name} declined your draw offer`, body: "The game goes on." };
        break;
      case "takeback":
        requestTakeback(g, color);
        if (g.takeback) note = { title: `${me.name} asks to take back a move`, body: "Open the game to allow or refuse." };
        break;
      case "accept-takeback":
        answerTakeback(g, color, true);
        note = { title: `${me.name} allowed your takeback`, body: "It's your move again." };
        break;
      case "decline-takeback":
        answerTakeback(g, color, false);
        note = { title: `${me.name} refused the takeback`, body: "It's still their move." };
        break;
      default:
        throw new HttpError(400, "Unknown action.");
    }
    const now = Date.now();
    const res = await env.DB.prepare(
      "UPDATE games SET state = ?, version = version + 1, status = ?, updated_at = ? WHERE id = ? AND version = ?",
    ).bind(JSON.stringify(g), g.status, now, row.id, row.version).run();
    if (!res.meta.changes) throw new HttpError(409, "The game changed at the same time. Refreshing...");

    if (oppId) {
      if (g.status === "finished") note = { title: `Chess with ${me.name}: game over`, body: describeChessEnd(g) };
      if (note) {
        const n = note;
        ctx.waitUntil(notify(env, origin, [oppId], (p) => ({ ...n, url: `/p/${p.token}/c/${row.id}`, tag: `chess-${row.id}` })));
      }
    }
    return json(chessViewFor(g, me.id, row.id, row.version + 1));
  }

  throw new HttpError(404, "Not found.");
}

/** Serves the app shell for personal links, pointing at a per-player manifest
 *  so "Add to Home Screen" opens straight into that person's link. */
async function serveShell(req: Request, env: Env, token: string): Promise<Response> {
  const res = await env.ASSETS.fetch(new URL("/index.html", req.url).toString());
  return new HTMLRewriter()
    .on("link[rel=manifest]", {
      element(el) { el.setAttribute("href", `/api/manifest/${token}`); },
    })
    .transform(new Response(res.body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, ctx, url);
      const p = /^\/p\/([\w-]+)(\/.*)?$/.exec(url.pathname);
      if (p) return await serveShell(req, env, p[1]);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof MoveError || e instanceof ChessError) return json({ error: e.message }, 422);
      console.error(e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
