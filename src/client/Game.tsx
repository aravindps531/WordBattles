import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { BLANK, rulesFor, TILE_POINTS } from "../shared/constants";
import type { Dictionary } from "../shared/dictionary";
import { evaluatePlacement, MoveError, type GameView, type Move, type PlacedTile } from "../shared/engine";
import { Api, ApiError } from "./api";
import { ChatPanel, useChat } from "./Chat";
import { HowToButton, HowToPanel, useHowTo, WordsHowTo } from "./HowTo";
import { loadDictionary } from "./words";

interface RackItem { id: number; t: string }               // t is a letter or "?" for a blank
interface Pending { r: number; c: number; l: string; item: RackItem }
interface Cursor { r: number; c: number; down: boolean }

let nextId = 1;
const POLL_MS = 15000;
const PREMIUM_LABEL = { QW: "4W", TW: "3W", DW: "2W", QL: "4L", TL: "3L", DL: "2L" } as const;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function rebuildRack(rack: string[], pending: Pending[], view: GameView) {
  const items = rack.map((t) => ({ id: nextId++, t }));
  const used = new Set<number>();
  const kept: Pending[] = [];
  for (const p of pending) {
    if (view.board[p.r][p.c]) continue; // square got taken by someone else's move
    const it = items.find((i) => !used.has(i.id) && i.t === p.item.t);
    if (!it) continue;
    used.add(it.id);
    kept.push({ ...p, item: it });
  }
  return { items, pending: kept };
}

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function moveText(view: GameView, m: Move, mySeat: number | null): string {
  const who = m.seat === mySeat ? "You" : view.seats[m.seat].name;
  switch (m.kind) {
    case "play": {
      const words = (m.words ?? []).map((w) => `${w.w} ${w.s}`).join(", ");
      return `${who} played ${m.words?.[0]?.w} for ${m.score}${m.bingo ? " (all 7 tiles, +50)" : ""}${(m.words?.length ?? 0) > 1 ? ` (${words})` : ""}`;
    }
    case "exchange": return `${who} swapped ${m.count} tile${m.count === 1 ? "" : "s"}`;
    case "pass": return `${who} passed`;
    case "resign": return `${who} left the game`;
  }
}

export function GamePage({ api, token, gameId }: { api: Api; token: string; gameId: string }) {
  const [view, setView] = useState<GameView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rack, setRack] = useState<RackItem[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSel, setSwapSel] = useState<Set<number>>(new Set());
  const [blankAt, setBlankAt] = useState<{ r: number; c: number; item: RackItem } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [dict, setDict] = useState<Dictionary | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const rules = rulesFor(view?.variant);
  // Big boards are hard to read on phones: start zoomed in there (scroll to move around).
  const [zoomed, setZoomed] = useState(() => window.innerWidth < 700);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  // When zoomed, centre the view on the latest word (or the centre star), once per new move.
  useEffect(() => {
    const wrap = boardWrapRef.current;
    if (!wrap || !view || rules.size <= 15 || !zoomed) return;
    let tiles: { r: number; c: number }[] = [];
    for (let i = view.moves.length - 1; i >= 0 && !tiles.length; i--) tiles = view.moves[i].tiles ?? [];
    const rs = tiles.length ? tiles.map((t) => t.r) : [rules.center];
    const cs = tiles.length ? tiles.map((t) => t.c) : [rules.center];
    const cell = wrap.scrollWidth / rules.size;
    const r = (Math.min(...rs) + Math.max(...rs) + 1) / 2;
    const c = (Math.min(...cs) + Math.max(...cs) + 1) / 2;
    wrap.scrollTo({ left: c * cell - wrap.clientWidth / 2, top: r * cell - wrap.clientHeight / 2 });
  }, [view?.version, zoomed, rules.size]);
  const [chatOpen, setChatOpen] = useState(() => new URLSearchParams(location.search).has("chat"));
  const versionRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => { loadDictionary().then(setDict).catch(() => {}); }, []);

  const applyView = useCallback((v: GameView) => {
    const changed = versionRef.current !== v.version;
    versionRef.current = v.version;
    setView(v);
    if (changed) {
      const { items, pending: kept } = rebuildRack(v.myRack, pendingRef.current, v);
      setRack(items);
      setPending(kept);
      setSelected(null);
      setSwapSel(new Set());
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.game(gameId, versionRef.current);
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

  const mySeat = view?.mySeat ?? null;
  const myTurn = !!view && view.status === "active" && view.turn === mySeat;
  const meId = view && mySeat !== null ? view.seats[mySeat].id : null;
  const chat = useChat(api, gameId, meId, chatOpen);
  const howTo = useHowTo("words");
  const lastMove = view?.moves[view.moves.length - 1];
  const lastPlay = useMemo(() => {
    if (!view) return null;
    for (let i = view.moves.length - 1; i >= 0; i--) if (view.moves[i].kind === "play") return view.moves[i];
    return null;
  }, [view]);
  const lastTiles = useMemo(
    () => new Set((lastPlay?.tiles ?? []).map((t) => `${t.r},${t.c}`)), [lastPlay],
  );
  const pendingAt = useMemo(() => new Map(pending.map((p) => [`${p.r},${p.c}`, p])), [pending]);
  const onRack = rack.filter((i) => !pending.some((p) => p.item.id === i.id));

  // Live preview: placement rules, score, and word validity.
  const preview = useMemo(() => {
    if (!view || pending.length === 0) return null;
    const tiles: PlacedTile[] = pending.map((p) => ({ r: p.r, c: p.c, l: p.l, b: p.item.t === BLANK }));
    try {
      const res = evaluatePlacement(view.board, tiles, rules);
      const invalid = dict ? [...new Set(res.words.filter((w) => !dict.has(w.word)).map((w) => w.word))] : [];
      return { ok: invalid.length === 0, res, invalid, tiles, error: null as string | null };
    } catch (e) {
      return { ok: false, res: null, invalid: [], tiles, error: e instanceof MoveError ? e.message : "Invalid placement" };
    }
  }, [view, pending, dict]);

  const isFree = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < rules.size && c < rules.size && !view!.board[r][c] && !pendingAt.has(`${r},${c}`);

  const advanceCursor = (cur: Cursor, extraTaken?: string): Cursor | null => {
    let { r, c } = cur;
    for (;;) {
      if (cur.down) r++; else c++;
      if (r >= rules.size || c >= rules.size) return null;
      if (isFree(r, c) && `${r},${c}` !== extraTaken) return { ...cur, r, c };
    }
  };

  const place = (r: number, c: number, item: RackItem, letter?: string) => {
    if (item.t === BLANK && !letter) { setBlankAt({ r, c, item }); return false; }
    setPending((ps) => [...ps, { r, c, l: letter ?? item.t, item }]);
    setSelected(null);
    setMessage(null);
    return true;
  };

  const onCell = (r: number, c: number) => {
    if (!view || swapMode || mySeat === null) return;
    const key = `${r},${c}`;
    const p = pendingAt.get(key);
    if (p) { setPending((ps) => ps.filter((x) => x !== p)); return; }
    if (view.board[r][c]) return;
    const sel = selected !== null ? onRack.find((i) => i.id === selected) : undefined;
    if (sel) {
      if (place(r, c, sel)) setCursor(null);
      return;
    }
    if (cursor && cursor.r === r && cursor.c === c) setCursor({ ...cursor, down: !cursor.down });
    else setCursor({ r, c, down: false });
  };

  const onRackTile = (item: RackItem) => {
    if (swapMode) {
      setSwapSel((s) => { const n = new Set(s); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; });
      return;
    }
    if (cursor && isFree(cursor.r, cursor.c)) {
      if (place(cursor.r, cursor.c, item)) setCursor(advanceCursor(cursor, `${cursor.r},${cursor.c}`));
      return;
    }
    setSelected((s) => (s === item.id ? null : item.id));
  };

  const chooseBlank = (letter: string) => {
    if (!blankAt) return;
    place(blankAt.r, blankAt.c, blankAt.item, letter);
    if (cursor && cursor.r === blankAt.r && cursor.c === blankAt.c) {
      setCursor(advanceCursor(cursor, `${cursor.r},${cursor.c}`));
    } else setCursor(null);
    setBlankAt(null);
  };

  const recall = () => { setPending([]); setSelected(null); setCursor(null); };

  const shuffleRack = () => {
    setRack((items) => {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    });
  };

  const submit = async (action: "play" | "pass" | "exchange" | "resign") => {
    if (!view || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const extra = action === "play"
        ? { tiles: preview!.tiles }
        : action === "exchange"
          ? { letters: rack.filter((i) => swapSel.has(i.id)).map((i) => i.t) }
          : {};
      if (action === "play" || action === "exchange") pendingRef.current = [];
      const v = await api.move(view.id, view.version, action, extra);
      setPending([]);
      setCursor(null);
      setSwapMode(false);
      applyView(v);
      const m = v.moves[v.moves.length - 1];
      if (action === "play" && m?.kind === "play") {
        setMessage({ kind: "info", text: `Nice! ${m.words?.[0]?.w} scored ${m.score}.` });
      }
    } catch (e) {
      pendingRef.current = pending;
      const err = e as ApiError;
      setMessage({ kind: "error", text: err.message });
      if (err.status === 409) { versionRef.current = undefined; await refresh(); }
    } finally {
      setBusy(false);
    }
  };

  // Keyboard support for tablets with keyboards and desktops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!view || blankAt || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (/^[A-Z]$/.test(k) && cursor && isFree(cursor.r, cursor.c)) {
        const item = onRack.find((i) => i.t === k) ?? onRack.find((i) => i.t === BLANK);
        if (!item) return;
        e.preventDefault();
        place(cursor.r, cursor.c, item, item.t === BLANK ? k : undefined);
        setCursor(advanceCursor(cursor, `${cursor.r},${cursor.c}`));
      } else if (e.key === "Backspace" && pending.length) {
        e.preventDefault();
        const last = pending[pending.length - 1];
        setPending(pending.slice(0, -1));
        setCursor({ r: last.r, c: last.c, down: cursor?.down ?? false });
      } else if (e.key === "Enter" && myTurn && preview?.ok) {
        e.preventDefault();
        submit("play");
      } else if (e.key === "Escape") {
        setCursor(null); setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loadError) {
    return (
      <div class="page">
        <a class="back" href={`/p/${token}`}>&larr; All games</a>
        <p class="error-box">{loadError}</p>
      </div>
    );
  }
  if (!view) return <div class="page"><p class="muted center">Loading game...</p></div>;

  const turnName = view.turn === mySeat ? "You" : view.seats[view.turn].name;
  const nextName = view.nextTurn === mySeat ? "you" : view.seats[view.nextTurn].name;
  const winners = view.end?.winners ?? [];

  return (
    <div class="game">
      <header class="game-top">
        <a class="back" href={`/p/${token}`} aria-label="All games">&larr; Games</a>
        <span class="top-right">
          {rules.variant === "mega" && <span class="mega-tag">Mega</span>}
          {mySeat === null && <span class="watch-tag">Watching</span>}
          <span class="bag" title="Tiles left in the bag">Bag: <b>{view.bagCount}</b></span>
          {rules.size > 15 && (
            <button class="btn zoom-btn" onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed}>
              {zoomed ? "Fit" : "Zoom"}
            </button>
          )}
          <HowToButton onClick={howTo.show} />
          <button class="btn chat-btn" hidden={mySeat === null} onClick={() => setChatOpen(true)}
            aria-label={chat.unread ? `Chat, ${chat.unread} unread` : "Chat"}>
            Chat{chat.unread > 0 && <span class="badge">{chat.unread}</span>}
          </button>
        </span>
      </header>

      {howTo.open && <HowToPanel k="words" title="Word Battles" onClose={howTo.close}><WordsHowTo /></HowToPanel>}
      {chatOpen && (
        <ChatPanel messages={chat.messages} meId={meId} onSend={chat.send} onClose={() => {
          setChatOpen(false);
          if (location.search) history.replaceState(null, "", location.pathname);
        }} />
      )}

      <TurnBanner view={view} myTurn={myTurn} turnName={turnName} nextName={nextName} winners={winners} mySeat={mySeat} />

      <ol class="players" aria-label="Players in turn order">
        {view.seats.map((s, i) => {
          const isTurn = view.status === "active" && i === view.turn;
          const isNext = view.status === "active" && i === view.nextTurn && view.nextTurn !== view.turn;
          const won = view.status === "finished" && winners.includes(i);
          return (
            <li key={s.id} class={`player ${isTurn ? "is-turn" : ""} ${isNext ? "is-next" : ""} ${s.resigned ? "resigned" : ""} ${won ? "won" : ""}`}>
              <span class="tag">{isTurn ? "Playing" : isNext ? "Next" : won ? "Winner" : s.resigned ? "Left" : `#${i + 1}`}</span>
              <span class="pname">{i === mySeat ? "You" : s.name}</span>
              <span class="pscore">{s.score}</span>
            </li>
          );
        })}
      </ol>

        <div ref={boardWrapRef} class={`board-wrap ${rules.size > 15 ? "big" : ""} ${rules.size > 15 && zoomed ? "zoomed" : ""}`}>
          <div class="board" role="grid" aria-label="Game board" style={{ "--n": rules.size }}>
            {view.board.map((rowCells, r) => rowCells.map((cell, c) => {
              const key = `${r},${c}`;
              const p = pendingAt.get(key);
              const prem = rules.premiums[r][c];
              const isCursor = cursor && cursor.r === r && cursor.c === c && !p && !cell;
              const cls = [
                "cell",
                prem ? `prem-${prem}` : "",
                r === rules.center && c === rules.center ? "center" : "",
                cell ? "has-tile" : "",
                p ? "has-pending" : "",
                cell && lastTiles.has(key) ? "last" : "",
                isCursor ? "cursor" : "",
              ].join(" ");
              return (
                <button key={key} class={cls} onClick={() => onCell(r, c)} aria-label={`Row ${r + 1} column ${c + 1}`}>
                  {cell ? (
                    <Tile letter={cell.l} blank={!!cell.b} />
                  ) : p ? (
                    <Tile letter={p.l} blank={p.item.t === BLANK} pending />
                  ) : isCursor ? (
                    <span class="arrow">{cursor!.down ? "▼" : "▶"}</span>
                  ) : prem ? (
                    <span class="prem-label">{r === rules.center && c === rules.center ? "★" : PREMIUM_LABEL[prem]}</span>
                  ) : null}
                </button>
              );
            }))}
          </div>
        </div>

        <div class="panel">
          {view.status === "active" && mySeat !== null && (
            <>
              <PreviewLine preview={preview} myTurn={myTurn} swapMode={swapMode} swapCount={swapSel.size} hasCursor={!!cursor} />
              <div class={`rack ${swapMode ? "swapping" : ""}`} aria-label="Your tiles" style={{ "--rack": rules.rackSize }}>
                {rack.map((item) => {
                  const used = pending.some((p) => p.item.id === item.id);
                  return (
                    <button
                      key={item.id}
                      class={`rack-slot ${used ? "used" : ""} ${selected === item.id ? "selected" : ""} ${swapSel.has(item.id) ? "swap-sel" : ""}`}
                      disabled={used}
                      onClick={() => onRackTile(item)}
                      aria-label={item.t === BLANK ? "Blank tile" : `Tile ${item.t}`}
                    >
                      {!used && <Tile letter={item.t === BLANK ? "" : item.t} blank={item.t === BLANK} />}
                    </button>
                  );
                })}
                {Array.from({ length: Math.max(0, rules.rackSize - rack.length) }, (_, i) => (
                  <span key={`e${i}`} class="rack-slot empty" />
                ))}
              </div>

              {message && <p class={message.kind === "error" ? "msg error" : "msg info"} role="status">{message.text}</p>}

              {swapMode ? (
                <div class="actions">
                  <button class="btn" onClick={() => { setSwapMode(false); setSwapSel(new Set()); }}>Cancel</button>
                  <button class="btn primary" disabled={!myTurn || swapSel.size === 0 || busy} onClick={() => submit("exchange")}>
                    Swap {swapSel.size || ""} tile{swapSel.size === 1 ? "" : "s"}
                  </button>
                </div>
              ) : (
                <div class="actions">
                  <button class="btn" onClick={shuffleRack} title="Shuffle your tiles">Shuffle</button>
                  <button class="btn" onClick={recall} disabled={pending.length === 0}>Recall</button>
                  <button class="btn" disabled={!myTurn || busy || view.bagCount < rules.rackSize}
                    title={view.bagCount < rules.rackSize ? `Fewer than ${rules.rackSize} tiles left in the bag` : "Swap tiles"}
                    onClick={() => { recall(); setSwapMode(true); }}>Swap</button>
                  <button class="btn" disabled={!myTurn || busy}
                    onClick={() => { if (confirm("Pass your turn without playing?")) submit("pass"); }}>Pass</button>
                  <button class="btn primary play" disabled={!myTurn || busy || !preview?.ok} onClick={() => submit("play")}>
                    {busy ? "..." : preview?.ok ? `Play ${preview.res!.score}` : "Play"}
                  </button>
                </div>
              )}
            </>
          )}

          {lastMove && (
            <p class="last-move">
              <span class="swatch" aria-hidden="true" /> Last move: {moveText(view, lastMove, mySeat)}
              <span class="muted"> &middot; {relTime(lastMove.at)}</span>
            </p>
          )}

          <details class="history" open={showHistory} onToggle={(e) => setShowHistory((e.target as HTMLDetailsElement).open)}>
            <summary>All moves ({view.moves.length})</summary>
            <ol reversed>
              {[...view.moves].reverse().map((m, i) => (
                <li key={i}>{moveText(view, m, mySeat)} <span class="muted">&middot; {relTime(m.at)}</span></li>
              ))}
            </ol>
          </details>

          {view.status === "active" && mySeat !== null && (
            <p class="leave">
              <button class="link-btn" onClick={() => {
                if (confirm("Leave this game? You can't rejoin it.")) submit("resign");
              }}>Leave game</button>
            </p>
          )}
        </div>

      {blankAt && (
        <div class="modal-back" onClick={() => setBlankAt(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose a letter for the blank">
            <h3>Blank tile: choose a letter</h3>
            <div class="letter-grid">
              {LETTERS.map((l) => <button key={l} class="btn letter" onClick={() => chooseBlank(l)}>{l}</button>)}
            </div>
            <button class="btn" onClick={() => setBlankAt(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ letter, blank, pending }: { letter: string; blank?: boolean; pending?: boolean }) {
  return (
    <span class={`tile ${blank ? "blank" : ""} ${pending ? "pending" : ""}`}>
      <span class="l">{letter}</span>
      {!blank && letter && <span class="pts">{TILE_POINTS[letter]}</span>}
    </span>
  );
}

function TurnBanner({ view, myTurn, turnName, nextName, winners, mySeat }: {
  view: GameView; myTurn: boolean; turnName: string; nextName: string; winners: number[]; mySeat: number | null;
}) {
  if (view.status === "finished") {
    const names = winners.map((s) => (s === mySeat ? "You" : view.seats[s].name));
    const iWon = mySeat !== null && winners.includes(mySeat);
    return (
      <div class={`banner done ${iWon ? "won" : ""}`}>
        <strong>Game over.</strong> {names.join(" & ")} won!
        {view.end?.reason === "scoreless" && <span class="sub"> Six turns in a row without a score; leftover tiles were deducted.</span>}
        {view.end?.reason === "out" && <span class="sub"> Tiles left on racks were deducted and given to the player who went out.</span>}
      </div>
    );
  }
  const streakWarn = view.scorelessStreak >= 4
    ? ` ${6 - view.scorelessStreak} more scoreless turn${6 - view.scorelessStreak === 1 ? "" : "s"} ends the game.` : "";
  return myTurn ? (
    <div class="banner mine" aria-live="polite">
      <strong>Your turn!</strong> <span class="sub">Next up: {nextName}.{streakWarn}</span>
    </div>
  ) : (
    <div class="banner waiting" aria-live="polite">
      <strong>{turnName}'s turn.</strong> <span class="sub">Then: {nextName}.{streakWarn}</span>
    </div>
  );
}

function PreviewLine({ preview, myTurn, swapMode, swapCount, hasCursor }: {
  preview: { ok: boolean; res: ReturnType<typeof evaluatePlacement> | null; invalid: string[]; error: string | null } | null;
  myTurn: boolean; swapMode: boolean; swapCount: number; hasCursor: boolean;
}) {
  if (swapMode) return <p class="hint">Tap the tiles you want to swap{swapCount ? ` (${swapCount} chosen)` : ""}.</p>;
  if (!preview) {
    return (
      <p class="hint">
        {hasCursor
          ? "Tap your letters. Tap the square again to go down."
          : myTurn
            ? "Tap a square, then tap your letters."
            : "Try out words while you wait."}
      </p>
    );
  }
  if (preview.error) return <p class="hint bad">{preview.error}</p>;
  if (preview.invalid.length) {
    return <p class="hint bad">Not in the dictionary: <b>{preview.invalid.join(", ")}</b></p>;
  }
  const r = preview.res!;
  return (
    <p class="hint good">
      {r.words.map((w) => `${w.word} ${w.score}`).join(" + ")}
      {r.bingo ? " + 50 bonus" : ""} = <b>{r.score} points</b>
    </p>
  );
}
