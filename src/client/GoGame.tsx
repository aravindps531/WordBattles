import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  currentBoard, describeGoEnd, groupAt, other, playerOf, pointName, scoreGame, starPoints, tryPlace,
  type GoColor, type GoView,
} from "../shared/go";
import type { Api, ApiError, GoAction } from "./api";
import { ChatPanel, useChat } from "./Chat";

const POLL_MS = 15000;
const CONFIRM_KEY = "swb-go-confirm";
const HINTS_KEY = "swb-go-hints";
const PAD = 0.9; // board margin in grid units (room for coordinates)
const LETTERS = "ABCDEFGHJKLMNOPQRST";

function readBool(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === "1"; } catch { return fallback; }
}
function writeBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ }
}
function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Points belonging to groups of `color` that have exactly one liberty. */
function groupsInAtari(board: string, size: number, color: GoColor): Set<number> {
  const out = new Set<number>();
  const seen = new Set<number>();
  for (let p = 0; p < board.length; p++) {
    if (board[p] !== color || seen.has(p)) continue;
    const g = groupAt(board, size, p);
    g.stones.forEach((s) => seen.add(s));
    if (g.liberties.size === 1) g.stones.forEach((s) => out.add(s));
  }
  return out;
}

export function GoPage({ api, token, gameId }: { api: Api; token: string; gameId: string }) {
  const [view, setView] = useState<GoView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ply, setPly] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [confirmMoves, setConfirmMoves] = useState(() => readBool(CONFIRM_KEY, true));
  const [hints, setHints] = useState(() => readBool(HINTS_KEY, false));
  const [chatOpen, setChatOpen] = useState(() => new URLSearchParams(location.search).has("chat"));
  const versionRef = useRef<number | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);

  const applyView = useCallback((v: GoView) => {
    if (versionRef.current !== v.version) setPending(null);
    versionRef.current = v.version;
    setView(v);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.go(gameId, versionRef.current);
      if ("unchanged" in r) return;
      applyView(r);
      setLoadError(null);
    } catch (e) {
      if (versionRef.current === undefined) setLoadError((e as Error).message);
    }
  }, [api, gameId, applyView]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "refresh") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [refresh]);

  const my: GoColor = view?.myColor ?? "b";
  const opp = other(my);
  const meId = view ? playerOf(view, my).id : null;
  const chat = useChat(api, gameId, meId, chatOpen);

  const act = useCallback(async (action: GoAction, point?: number) => {
    if (!view) return;
    setBusy(true);
    setMessage(null);
    try {
      applyView(await api.goAction(view.id, view.version, action, point));
      setPly(null);
    } catch (e) {
      const err = e as ApiError;
      setMessage({ kind: "error", text: err.message });
      if (err.status === 409) { versionRef.current = undefined; await refresh(); }
    } finally {
      setBusy(false);
    }
  }, [api, view, applyView, refresh]);

  const live = ply === null;
  const myTurn = !!view && view.phase === "play" && view.turn === my;
  const scoring = view?.phase === "scoring";

  const shownBoard = useMemo(() => {
    if (!view) return "";
    if (pending !== null) {
      const r = tryPlace(currentBoard(view), view.size, my, pending);
      return "board" in r ? r.board : currentBoard(view);
    }
    return ply !== null ? view.boards[ply] : currentBoard(view);
  }, [view, pending, ply, my]);
  const shownPly = view ? (ply ?? view.moves.length) : 0;
  const lastPoint = pending ?? (shownPly > 0 ? view!.moves[shownPly - 1].point : null);

  const score = useMemo(() => (view && (scoring || view.phase === "finished") && live ? scoreGame(view) : null), [view, scoring, live]);
  const dead = useMemo(() => new Set(scoring && live ? view!.dead : []), [view, scoring, live]);
  const territory = useMemo(() => {
    const m = new Map<number, GoColor>();
    if (score && scoring) {
      score.blackTerritory.forEach((p) => m.set(p, "b"));
      score.whiteTerritory.forEach((p) => m.set(p, "w"));
    }
    return m;
  }, [score, scoring]);
  const danger = useMemo(
    () => (hints && view && live && view.phase === "play" ? groupsInAtari(shownBoard, view.size, my) : new Set<number>()),
    [hints, view, live, shownBoard, my],
  );
  const chances = useMemo(
    () => (hints && view && live && view.phase === "play" && pending === null ? groupsInAtari(shownBoard, view.size, opp) : new Set<number>()),
    [hints, view, live, shownBoard, opp, pending],
  );

  const onBoardClick = (e: MouseEvent) => {
    if (!view || !live || busy || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const units = view.size - 1 + PAD * 2;
    const x = ((e.clientX - rect.left) / rect.width) * units - PAD;
    const y = ((e.clientY - rect.top) / rect.height) * units - PAD;
    const c = Math.round(x), r = Math.round(y);
    if (c < 0 || r < 0 || c >= view.size || r >= view.size) return;
    if (Math.hypot(x - c, y - r) > 0.55) return;
    const p = r * view.size + c;

    if (scoring) {
      if (currentBoard(view)[p] !== ".") act("toggle-dead", p);
      return;
    }
    if (!myTurn) return;
    if (pending === p) { act("play", p); return; } // second tap on the same point confirms
    const res = tryPlace(currentBoard(view), view.size, my, p);
    if ("error" in res) { setMessage({ kind: "error", text: res.error }); setPending(null); return; }
    if (view.boards.includes(res.board)) {
      setMessage({ kind: "error", text: "Ko: that would repeat an earlier position. Play elsewhere first." });
      setPending(null);
      return;
    }
    setMessage(null);
    if (confirmMoves) setPending(p);
    else act("play", p);
  };

  if (loadError) {
    return (
      <div class="page">
        <a class="back" href={`/p/${token}`}>&larr; All games</a>
        <p class="error-box">{loadError}</p>
      </div>
    );
  }
  if (!view) return <div class="page"><p class="muted center">Loading game...</p></div>;

  const n = view.size;
  const units = n - 1 + PAD * 2;
  const theirName = playerOf(view, opp).name;
  const nameOf = (c: GoColor) => (c === my ? "You" : playerOf(view, c).name);
  const youWon = view.result?.winner === my;
  const pendingWarn = pending !== null && hints && groupAt(shownBoard, n, pending).liberties.size === 1;
  const stars = new Set(starPoints(view.size));

  const PlayerBar = ({ c }: { c: GoColor }) => {
    const toMove = view.phase === "play" && view.turn === c;
    return (
      <div class={`cplayer ${toMove ? "to-move" : ""}`}>
        <span class={`gstone-icon ${c}`} aria-hidden="true" />
        <span class="cname">{nameOf(c)}</span>
        <span class="muted small">captured {view.prisoners[c]}{c === "w" ? ` · komi ${view.komi}` : ""}</span>
        {toMove && <span class="cturn">{c === my ? "Your move" : "To move"}</span>}
        {scoring && <span class="cturn">{view.accepted.includes(c) ? "Accepted" : "Counting"}</span>}
      </div>
    );
  };

  return (
    <div class="game chess go">
      <header class="game-top">
        <a class="back" href={`/p/${token}`} aria-label="All games">&larr; Games</a>
        <span class="top-right">
          <span class="muted small">Go {n}&times;{n} &middot; move {view.moves.length + 1}</span>
          <button class="btn chat-btn" onClick={() => setChatOpen(true)} aria-label={chat.unread ? `Chat, ${chat.unread} unread` : "Chat"}>
            Chat{chat.unread > 0 && <span class="badge">{chat.unread}</span>}
          </button>
        </span>
      </header>

      {chatOpen && (
        <ChatPanel messages={chat.messages} meId={meId} onSend={chat.send} onClose={() => {
          setChatOpen(false);
          if (location.search) history.replaceState(null, "", location.pathname);
        }} />
      )}

      {view.phase === "finished" ? (
        <div class={`banner done ${youWon ? "won" : ""}`}>
          <strong>{youWon ? "You won!" : `${theirName} won.`}</strong>
          <span class="sub">{describeGoEnd(view)}</span>
        </div>
      ) : scoring ? (
        <div class={`banner ${view.accepted.includes(my) ? "waiting" : "mine"}`} aria-live="polite">
          <strong>Counting the score.</strong>
          <span class="sub">{view.accepted.includes(my) ? `Waiting for ${theirName} to accept.` : "Tap any dead groups, then accept."}</span>
        </div>
      ) : myTurn ? (
        <div class="banner mine" aria-live="polite">
          <strong>Your move!</strong>
          <span class="sub">You play {my === "b" ? "Black" : "White"} vs {theirName}.{view.moves.at(-1)?.point === null && view.moves.length ? ` ${theirName} passed.` : ""}</span>
        </div>
      ) : (
        <div class="banner waiting" aria-live="polite">
          <strong>{theirName}'s move.</strong>
          <span class="sub">You play {my === "b" ? "Black" : "White"}.</span>
        </div>
      )}

      {view.phase === "play" && view.takeback === opp && (
        <div class="offer">
          <span>{theirName} asks to take back their last move.</span>
          <button class="btn" disabled={busy} onClick={() => act("decline-takeback")}>Refuse</button>
          <button class="btn primary" disabled={busy} onClick={() => act("accept-takeback")}>Allow</button>
        </div>
      )}
      {view.phase === "play" && view.takeback === my && <p class="offer-note muted small">You asked to take back your move. Waiting for {theirName}.</p>}

      <div class="board-wrap">
        <div class="chess-col">
          <PlayerBar c={opp} />
          <svg ref={svgRef} class="goboard" viewBox={`0 0 ${units} ${units}`} onClick={onBoardClick} role="img"
            aria-label={`Go board, ${n} by ${n}`}>
            <rect x="0" y="0" width={units} height={units} rx="0.25" fill="#dcb35c" />
            {Array.from({ length: n }, (_, i) => (
              <g key={i}>
                <line x1={PAD} y1={PAD + i} x2={PAD + n - 1} y2={PAD + i} stroke="#3b2a14" stroke-width="0.04" />
                <line x1={PAD + i} y1={PAD} x2={PAD + i} y2={PAD + n - 1} stroke="#3b2a14" stroke-width="0.04" />
                <text x={PAD + i} y={PAD - 0.55} class="gcoord">{LETTERS[i]}</text>
                <text x={PAD - 0.6} y={PAD + i + 0.12} class="gcoord">{n - i}</text>
              </g>
            ))}
            {[...stars].map((p) => <circle key={`s${p}`} cx={PAD + (p % n)} cy={PAD + Math.floor(p / n)} r="0.1" fill="#3b2a14" />)}
            {[...territory].map(([p, c]) => (
              <rect key={`t${p}`} x={PAD + (p % n) - 0.11} y={PAD + Math.floor(p / n) - 0.11} width="0.22" height="0.22"
                fill={c === "b" ? "#111" : "#fff"} opacity="0.75" stroke="#555" stroke-width="0.015" />
            ))}
            {[...shownBoard].map((ch, p) => {
              if (ch === ".") return null;
              const cx = PAD + (p % n), cy = PAD + Math.floor(p / n);
              const isDead = dead.has(p);
              return (
                <g key={p} opacity={isDead ? 0.4 : 1}>
                  <circle cx={cx} cy={cy} r="0.47" fill={ch === "b" ? "url(#gb)" : "url(#gw)"} stroke={ch === "w" ? "#888" : "none"} stroke-width="0.03" />
                  {isDead && <path d={`M${cx - 0.2} ${cy - 0.2}L${cx + 0.2} ${cy + 0.2}M${cx + 0.2} ${cy - 0.2}L${cx - 0.2} ${cy + 0.2}`} stroke="#c0392b" stroke-width="0.08" />}
                  {p === lastPoint && !isDead && <circle cx={cx} cy={cy} r="0.2" fill="none" stroke={ch === "b" ? "#fff" : "#111"} stroke-width="0.07" />}
                  {danger.has(p) && <circle cx={cx} cy={cy} r="0.5" fill="none" stroke="#e74c3c" stroke-width="0.08" />}
                  {chances.has(p) && <circle cx={cx} cy={cy} r="0.5" fill="none" stroke="#27ae60" stroke-width="0.08" stroke-dasharray="0.15 0.1" />}
                </g>
              );
            })}
            {pending !== null && (
              <circle cx={PAD + (pending % n)} cy={PAD + Math.floor(pending / n)} r="0.5" fill="none" stroke="#7a2e1f" stroke-width="0.07" />
            )}
            <defs>
              <radialGradient id="gb" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#666" /><stop offset="1" stop-color="#0a0a0a" /></radialGradient>
              <radialGradient id="gw" cx="0.35" cy="0.35" r="0.75"><stop offset="0" stop-color="#fff" /><stop offset="1" stop-color="#d6d6d6" /></radialGradient>
            </defs>
          </svg>
          <PlayerBar c={my} />
        </div>
      </div>

      <div class="panel">
        {scoring ? (
          <>
            {score && (
              <p class="score-line">
                Black <b>{score.black}</b> &middot; White <b>{score.white}</b> <span class="muted small">(incl. {view.komi} komi)</span>
                {" "}&rarr; {score.black > score.white ? `${nameOf("b")} lead${nameOf("b") === "You" ? "" : "s"} by ${score.black - score.white}` : `${nameOf("w")} lead${nameOf("w") === "You" ? "" : "s"} by ${score.white - score.black}`}
              </p>
            )}
            <p class="hint">Tap a group to mark it dead (or alive again). Small squares show whose area each point is.</p>
            <div class="actions two">
              <button class="btn" disabled={busy} onClick={() => act("resume")}>Resume play</button>
              <button class="btn primary" disabled={busy || view.accepted.includes(my)} onClick={() => act("accept-score")}>
                {view.accepted.includes(my) ? "Accepted" : "Accept score"}
              </button>
            </div>
          </>
        ) : pending !== null ? (
          <>
            {pendingWarn && <p class="hint bad">Careful: this stone could be captured on the next move.</p>}
            <div class="actions two">
              <button class="btn" onClick={() => setPending(null)}>Cancel</button>
              <button class="btn primary" disabled={busy} onClick={() => act("play", pending)}>Play {pointName(n, pending)}</button>
            </div>
          </>
        ) : (
          <div class="replay">
            <button class="btn" aria-label="First move" disabled={shownPly === 0} onClick={() => setPly(0)}>&laquo;</button>
            <button class="btn" aria-label="Previous move" disabled={shownPly === 0} onClick={() => setPly(Math.max(0, shownPly - 1))}>&lsaquo;</button>
            <button class="btn" aria-label="Next move" disabled={live} onClick={() => setPly(shownPly + 1 >= view.moves.length ? null : shownPly + 1)}>&rsaquo;</button>
            <button class="btn" aria-label="Latest position" disabled={live} onClick={() => setPly(null)}>&raquo;</button>
          </div>
        )}
        {!live && <p class="hint">Showing the board after move {shownPly}. <button class="link-btn" onClick={() => setPly(null)}>Back to the game</button></p>}
        {live && myTurn && pending === null && <p class="hint">Tap a point to place a stone.{confirmMoves ? " Tap it again (or Play) to confirm." : ""}</p>}
        {hints && live && view.phase === "play" && (danger.size > 0 || chances.size > 0) && (
          <p class="hint">
            {danger.size > 0 && <span class="bad">Red rings: your stones that could be captured next move. </span>}
            {chances.size > 0 && <span class="good">Green rings: stones you could capture now.</span>}
          </p>
        )}
        {message && <p class={message.kind === "error" ? "msg error" : "msg info"} role="status">{message.text}</p>}

        <div class="movelist go-moves" aria-label="Moves">
          {view.moves.length === 0 && <span class="muted small">No moves yet.{view.handicap ? ` Black has ${view.handicap} handicap stones; White moves first.` : ""}</span>}
          {view.moves.map((m, i) => (
            <button key={i} class={`mv ${shownPly === i + 1 ? "cur" : ""}`} onClick={() => setPly(i + 1 === view.moves.length ? null : i + 1)}>
              <span class="mnum">{i + 1}.</span> <span class={`gstone-icon small ${m.color}`} aria-label={m.color === "b" ? "Black" : "White"} /> {m.point === null ? "pass" : pointName(n, m.point)}
            </button>
          ))}
        </div>
        {view.moves.length > 0 && <p class="muted small">Last move {relTime(view.moves[view.moves.length - 1].at)}.</p>}

        {view.phase === "play" && (
          <div class="chess-actions">
            <button class="btn" disabled={!myTurn || busy}
              onClick={() => { if (confirm(`Pass? If ${theirName} passes too, the game will be counted.`)) act("pass"); }}>Pass</button>
            <button class="btn" disabled={busy || view.moves.at(-1)?.color !== my || view.takeback === my || myTurn}
              onClick={() => act("takeback")}>Ask takeback</button>
            <button class="btn" disabled={busy} onClick={() => { if (confirm("Resign this game?")) act("resign"); }}>Resign</button>
          </div>
        )}
        {view.phase !== "finished" && (
          <>
            <label class="setting">
              <input type="checkbox" checked={confirmMoves} onChange={(e) => {
                const v = (e.target as HTMLInputElement).checked; setConfirmMoves(v); writeBool(CONFIRM_KEY, v);
              }} />
              Ask me to confirm each move
            </label>
            <label class="setting">
              <input type="checkbox" checked={hints} onChange={(e) => {
                const v = (e.target as HTMLInputElement).checked; setHints(v); writeBool(HINTS_KEY, v);
              }} />
              Beginner hints (show stones that can be captured)
            </label>
          </>
        )}
      </div>
    </div>
  );
}
