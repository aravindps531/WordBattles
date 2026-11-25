import { Chess, type Square } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { describeChessEnd, isCpu, other, type ChessView, type Color } from "../shared/chess";
import { Api, type ApiError, type ChessAction } from "./api";
import { ChatPanel, useChat } from "./Chat";
import { ChessHowTo, HowToButton, HowToPanel, useHowTo } from "./HowTo";
import { getEngine, levelOptions, winChance } from "./engine";

const POLL_MS = 15000;
const FILES = "abcdefgh";
const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const CONFIRM_KEY = "swb-chess-confirm";

type Mark = "best" | "good" | "inaccuracy" | "mistake" | "blunder";
interface PlyReview { mark: Mark; loss: number; bestSan: string | null; bestUci: string | null }
interface Review { plies: PlyReview[]; evals: number[] /* White win chance per position */ }

const MARK_SYMBOL: Record<Mark, string> = { best: "", good: "", inaccuracy: "?!", mistake: "?", blunder: "??" };

function readBool(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === "1"; } catch { return fallback; }
}
function writeBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ }
}

function pieceUrl(color: Color, type: string) {
  return `/pieces/${color}${type.toUpperCase()}.svg`;
}

/** Pieces each side has captured, and the material balance, for a position. */
function material(fen: string) {
  const counts: Record<Color, Record<string, number>> = { w: {}, b: {} };
  for (const ch of fen.split(" ")[0]) {
    if (!/[a-z]/i.test(ch)) continue;
    const c: Color = ch === ch.toUpperCase() ? "w" : "b";
    const t = ch.toLowerCase();
    counts[c][t] = (counts[c][t] ?? 0) + 1;
  }
  const lost = (c: Color) => {
    const out: string[] = [];
    for (const t of ["q", "r", "b", "n", "p"]) {
      for (let i = counts[c][t] ?? 0; i < START_COUNT[t]; i++) out.push(t);
    }
    return out;
  };
  const score = (c: Color) => Object.entries(counts[c]).reduce((s, [t, n]) => s + VALUES[t] * n, 0);
  return { capturedBy: { w: lost("b"), b: lost("w") }, diff: score("w") - score("b") };
}

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function ChessPage({ api, token, gameId }: { api: Api; token: string; gameId: string }) {
  const [view, setView] = useState<ChessView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ply, setPly] = useState<number | null>(null); // null = live position
  const [selected, setSelected] = useState<Square | null>(null);
  const [pending, setPending] = useState<{ uci: string; san: string; fen: string } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [confirmMoves, setConfirmMoves] = useState(() => readBool(CONFIRM_KEY, true));
  const [thinking, setThinking] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewProgress, setReviewProgress] = useState<number | null>(null);
  const versionRef = useRef<number | undefined>(undefined);
  const cpuRunning = useRef(false);

  const applyView = useCallback((v: ChessView) => {
    if (versionRef.current !== v.version) {
      setSelected(null);
      setPending(null);
    }
    versionRef.current = v.version;
    setView(v);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.chess(gameId, versionRef.current);
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

  // Restore a saved review for finished games.
  useEffect(() => {
    if (!view || view.status !== "finished") return;
    try {
      const saved = localStorage.getItem(`swb-review-${view.id}`);
      if (saved) {
        const r = JSON.parse(saved) as Review;
        if (r.plies.length === view.moves.length) setReview(r);
      }
    } catch { /* ignore */ }
  }, [view?.id, view?.status, view?.moves.length]);

  const act = useCallback(async (action: ChessAction, uci?: string) => {
    if (!view) return null;
    setBusy(true);
    setMessage(null);
    try {
      const v = await api.chessAction(view.id, view.version, action, uci);
      applyView(v);
      setPly(null);
      return v;
    } catch (e) {
      const err = e as ApiError;
      setMessage({ kind: "error", text: err.message });
      if (err.status === 409) { versionRef.current = undefined; await refresh(); }
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, view, applyView, refresh]);

  const my = view?.myColor ?? "w";
  const opp = other(my);
  const oppSide = view ? (opp === "w" ? view.white : view.black) : null;
  const vsCpu = !!oppSide && isCpu(oppSide);
  const live = ply === null;
  const myTurn = !!view && view.status === "active" && view.turn === my;
  const cpuTurn = !!view && view.status === "active" && vsCpu && view.turn === opp;
  const mySide = view ? (my === "w" ? view.white : view.black) : null;
  const meId = mySide && !isCpu(mySide) ? mySide.id : null;
  const [chatOpen, setChatOpen] = useState(() => new URLSearchParams(location.search).has("chat"));
  const chat = useChat(api, gameId, meId, chatOpen && !vsCpu);
  const howTo = useHowTo("chess");

  // Let the computer move when it's its turn.
  useEffect(() => {
    if (!view || !cpuTurn || cpuRunning.current || busy) return;
    cpuRunning.current = true;
    setThinking(true);
    const level = isCpu(oppSide!) ? oppSide!.cpu : 3;
    const fen = view.fens[view.fens.length - 1];
    const startedAt = Date.now();
    getEngine().search(fen, levelOptions(level))
      .then(async (r) => {
        // Small pause so the reply doesn't feel instant at low levels.
        const wait = Math.max(0, 700 - (Date.now() - startedAt));
        await new Promise((res) => setTimeout(res, wait));
        if (r.best) await act("cpu-move", r.best);
      })
      .catch((e) => setMessage({ kind: "error", text: (e as Error).message }))
      .finally(() => { cpuRunning.current = false; setThinking(false); });
  }, [view?.version, cpuTurn]);

  const shownFen = useMemo(() => {
    if (!view) return null;
    if (pending) return pending.fen;
    if (ply !== null) return view.fens[ply];
    return view.fens[view.fens.length - 1];
  }, [view, pending, ply]);
  const shownPly = view ? (ply ?? view.moves.length) : 0;

  const position = useMemo(() => (shownFen ? new Chess(shownFen) : null), [shownFen]);
  const interactive = !!view && live && !pending && view.status === "active" && myTurn && !busy;

  const legalTargets = useMemo(() => {
    if (!position || !selected || !interactive) return new Map<string, boolean>();
    return new Map(position.moves({ square: selected, verbose: true }).map((m) => [m.to, !!m.captured]));
  }, [position, selected, interactive]);

  const lastMoveUci = pending ? pending.uci : shownPly > 0 ? view!.moves[shownPly - 1].uci : null;
  const highlight = new Set(lastMoveUci ? [lastMoveUci.slice(0, 2), lastMoveUci.slice(2, 4)] : []);
  const checkSquare = useMemo(() => {
    if (!position || !position.inCheck()) return null;
    const t = position.turn();
    for (const row of position.board()) for (const p of row) if (p && p.type === "k" && p.color === t) return p.square;
    return null;
  }, [position]);
  const reviewHere = review && shownPly > 0 ? review.plies[shownPly - 1] : null;
  const bestSquares = new Set(
    reviewHere?.bestUci && reviewHere.mark !== "best" ? [reviewHere.bestUci.slice(0, 2), reviewHere.bestUci.slice(2, 4)] : [],
  );

  const makeMove = (from: Square, to: Square, promotion?: string) => {
    const c = new Chess(view!.fens[view!.fens.length - 1]);
    let m;
    try { m = c.move({ from, to, promotion: promotion ?? "q" }); } catch { return; }
    const uci = m.from + m.to + (m.promotion ?? "");
    setSelected(null);
    if (confirmMoves) setPending({ uci, san: m.san, fen: c.fen() });
    else act("move", uci);
  };

  const onSquare = (sq: Square) => {
    if (!interactive || !position) return;
    if (selected && legalTargets.has(sq)) {
      const piece = position.get(selected);
      if (piece?.type === "p" && (sq[1] === "8" || sq[1] === "1")) { setPromo({ from: selected, to: sq }); return; }
      makeMove(selected, sq);
      return;
    }
    const p = position.get(sq);
    if (p && p.color === my) setSelected(selected === sq ? null : sq);
    else setSelected(null);
  };

  const runReview = async () => {
    if (!view) return;
    const fens = view.fens;
    const evals: number[] = [];       // White's win chance at each position
    const bests: (string | null)[] = [];
    setReviewProgress(0);
    try {
      const engine = getEngine();
      for (let i = 0; i < fens.length; i++) {
        const c = new Chess(fens[i]);
        const stm = c.turn();
        let wc: number;
        let best: string | null = null;
        if (c.isCheckmate()) wc = 0;
        else if (c.isStalemate() || c.isInsufficientMaterial()) wc = 50;
        else {
          const r = await engine.search(fens[i], { depth: 12, movetime: 800 });
          wc = winChance(r.cp, r.mate);
          best = r.best;
        }
        evals.push(stm === "w" ? wc : 100 - wc);
        bests.push(best);
        setReviewProgress(Math.round(((i + 1) / fens.length) * 100));
      }
      const plies: PlyReview[] = view.moves.map((mv, i) => {
        const mover: Color = i % 2 === 0 ? "w" : "b";
        const before = mover === "w" ? evals[i] : 100 - evals[i];
        const after = mover === "w" ? evals[i + 1] : 100 - evals[i + 1];
        const loss = Math.max(0, before - after);
        const bestUci = bests[i];
        let bestSan: string | null = null;
        if (bestUci) {
          try {
            bestSan = new Chess(fens[i]).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] ?? "q" }).san;
          } catch { /* ignore */ }
        }
        const mark: Mark = bestUci === mv.uci ? "best" : loss >= 15 ? "blunder" : loss >= 10 ? "mistake" : loss >= 5 ? "inaccuracy" : "good";
        return { mark, loss, bestSan, bestUci };
      });
      const r = { plies, evals };
      setReview(r);
      try { localStorage.setItem(`swb-review-${view.id}`, JSON.stringify(r)); } catch { /* ignore */ }
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setReviewProgress(null);
    }
  };

  if (loadError) {
    return (
      <div class="page">
        <a class="back" href={`/p/${token}`}>&larr; All games</a>
        <p class="error-box">{loadError}</p>
      </div>
    );
  }
  if (!view || !position) return <div class="page"><p class="muted center">Loading game...</p></div>;

  const orientation: Color = flipped ? other(my) : my;
  const ranks = orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "w" ? FILES.split("") : FILES.split("").reverse();
  const mat = material(shownFen!);
  const topColor = other(orientation);
  const bottomColor = orientation;
  const sideName = (c: Color) => (c === view.myColor ? "You" : (c === "w" ? view.white : view.black).name);
  const theirName = oppSide!.name;
  const pairs: { n: number; w?: number; b?: number }[] = [];
  for (let i = 0; i < view.moves.length; i += 2) pairs.push({ n: i / 2 + 1, w: i, b: i + 1 < view.moves.length ? i + 1 : undefined });
  const lastMove = view.moves[view.moves.length - 1];
  const youWon = view.result && ((view.result === "1-0" && view.myColor === "w") || (view.result === "0-1" && view.myColor === "b"));

  const PlayerBar = ({ c }: { c: Color }) => {
    const toMove = view.status === "active" && view.turn === c;
    const adv = c === "w" ? mat.diff : -mat.diff;
    return (
      <div class={`cplayer ${toMove ? "to-move" : ""}`}>
        <span class={`cdot ${c}`} aria-hidden="true" />
        <span class="cname">{sideName(c)}</span>
        <span class="captured" aria-label="Captured pieces">
          {mat.capturedBy[c].map((t, i) => <img key={i} src={pieceUrl(other(c), t)} alt={t} />)}
          {adv > 0 && <span class="adv">+{adv}</span>}
        </span>
        {toMove && <span class="cturn">{c === view.myColor ? "Your move" : "To move"}</span>}
      </div>
    );
  };

  return (
    <div class="game chess">
      <header class="game-top">
        <a class="back" href={`/p/${token}`} aria-label="All games">&larr; Games</a>
        <span class="top-right">
          <span class="muted small">Move {Math.floor(view.moves.length / 2) + 1}</span>
          <HowToButton onClick={howTo.show} />
          {!vsCpu && (
            <button class="btn chat-btn" onClick={() => setChatOpen(true)}
              aria-label={chat.unread ? `Chat, ${chat.unread} unread` : "Chat"}>
              Chat{chat.unread > 0 && <span class="badge">{chat.unread}</span>}
            </button>
          )}
        </span>
      </header>

      {howTo.open && <HowToPanel k="chess" title="Chess" onClose={howTo.close}><ChessHowTo /></HowToPanel>}
      {chatOpen && !vsCpu && (
        <ChatPanel messages={chat.messages} meId={meId} onSend={chat.send} onClose={() => {
          setChatOpen(false);
          if (location.search) history.replaceState(null, "", location.pathname);
        }} />
      )}

      {view.status === "finished" ? (
        <div class={`banner done ${youWon ? "won" : ""}`}>
          <strong>{view.result === "1/2-1/2" ? "Draw." : youWon ? "You won!" : `${theirName} won.`}</strong>
          <span class="sub">{describeChessEnd(view)}</span>
        </div>
      ) : myTurn ? (
        <div class="banner mine" aria-live="polite">
          <strong>Your move{position.inCheck() && live && !pending ? ", you're in check!" : "!"}</strong>
          <span class="sub">You play {my === "w" ? "White" : "Black"} vs {theirName}.</span>
        </div>
      ) : (
        <div class="banner waiting" aria-live="polite">
          <strong>{cpuTurn ? (thinking ? "The computer is thinking..." : "Computer's move") : `${theirName}'s move.`}</strong>
          <span class="sub">You play {my === "w" ? "White" : "Black"}.</span>
        </div>
      )}

      {view.status === "active" && view.drawOffer === opp && (
        <div class="offer">
          <span>{theirName} offers a draw.</span>
          <button class="btn" disabled={busy} onClick={() => act("decline-draw")}>Decline</button>
          <button class="btn primary" disabled={busy} onClick={() => act("accept-draw")}>Accept draw</button>
        </div>
      )}
      {view.status === "active" && view.takeback === opp && (
        <div class="offer">
          <span>{theirName} asks to take back their last move.</span>
          <button class="btn" disabled={busy} onClick={() => act("decline-takeback")}>Refuse</button>
          <button class="btn primary" disabled={busy} onClick={() => act("accept-takeback")}>Allow</button>
        </div>
      )}
      {view.status === "active" && view.drawOffer === my && <p class="offer-note muted small">You offered a draw. Waiting for {theirName}.</p>}
      {view.status === "active" && view.takeback === my && <p class="offer-note muted small">You asked to take back your move. Waiting for {theirName}.</p>}

      <div class="board-wrap">
        <div class="chess-col">
          <PlayerBar c={topColor} />
          <div class="cboard" role="grid" aria-label="Chess board">
            {ranks.map((r, ri) => files.map((f, fi) => {
              const sq = `${f}${r}` as Square;
              const p = position.get(sq);
              const dark = (FILES.indexOf(f) + r) % 2 === 1;
              const target = legalTargets.get(sq);
              const cls = [
                "sq", dark ? "dark" : "light",
                highlight.has(sq) ? "last" : "",
                selected === sq ? "sel" : "",
                checkSquare === sq ? "check" : "",
                bestSquares.has(sq) ? "best" : "",
                target !== undefined ? (target ? "target capture" : "target") : "",
              ].join(" ");
              return (
                <button key={sq} class={cls} onClick={() => onSquare(sq)} aria-label={`${sq}${p ? ` ${p.color === "w" ? "white" : "black"} ${p.type}` : ""}`}>
                  {p && <img class="piece" src={pieceUrl(p.color, p.type)} alt="" draggable={false} />}
                  {fi === 0 && <span class="coord rank">{r}</span>}
                  {ri === 7 && <span class="coord file">{f}</span>}
                </button>
              );
            }))}
          </div>
          <PlayerBar c={bottomColor} />
        </div>
      </div>

      <div class="panel">
        {pending ? (
          <div class="actions two">
            <button class="btn" onClick={() => setPending(null)}>Cancel</button>
            <button class="btn primary" disabled={busy} onClick={() => act("move", pending.uci)}>Play {pending.san}</button>
          </div>
        ) : (
          <div class="replay">
            <button class="btn" aria-label="First move" disabled={shownPly === 0} onClick={() => setPly(0)}>&laquo;</button>
            <button class="btn" aria-label="Previous move" disabled={shownPly === 0} onClick={() => setPly(Math.max(0, shownPly - 1))}>&lsaquo;</button>
            <button class="btn" aria-label="Next move" disabled={live} onClick={() => setPly(shownPly + 1 >= view.moves.length ? null : shownPly + 1)}>&rsaquo;</button>
            <button class="btn" aria-label="Latest position" disabled={live} onClick={() => setPly(null)}>&raquo;</button>
            <button class="btn" onClick={() => setFlipped((f) => !f)}>Flip</button>
          </div>
        )}
        {!live && !pending && <p class="hint">Showing the position after move {Math.ceil(shownPly / 2) || "0"}. <button class="link-btn" onClick={() => setPly(null)}>Back to the game</button></p>}
        {live && myTurn && !pending && <p class="hint">{selected ? "Tap a highlighted square to move." : "Tap a piece to see where it can go."}</p>}

        {message && <p class={message.kind === "error" ? "msg error" : "msg info"} role="status">{message.text}</p>}

        {reviewHere && (
          <p class={`review-note mark-${reviewHere.mark}`}>
            <b>{view.moves[shownPly - 1].san}</b>{" "}
            {reviewHere.mark === "best" ? "was the engine's top choice."
              : reviewHere.mark === "good" ? `was fine.${reviewHere.bestSan ? ` The engine preferred ${reviewHere.bestSan}.` : ""}`
              : `was ${reviewHere.mark === "inaccuracy" ? "an inaccuracy" : `a ${reviewHere.mark}`}.${reviewHere.bestSan ? ` Better was ${reviewHere.bestSan} (shown in blue).` : ""}`}
          </p>
        )}

        <div class="movelist" aria-label="Moves">
          {pairs.length === 0 && <span class="muted small">No moves yet.</span>}
          {pairs.map((p) => (
            <div class="mrow" key={p.n}>
              <span class="mnum">{p.n}.</span>
              {[p.w, p.b].map((i) => i === undefined ? <span key="x" /> : (
                <button key={i} class={`mv ${shownPly === i + 1 ? "cur" : ""} ${review ? `mark-${review.plies[i]?.mark}` : ""}`}
                  onClick={() => setPly(i + 1 === view.moves.length ? null : i + 1)}>
                  {view.moves[i].san}{review ? MARK_SYMBOL[review.plies[i]?.mark ?? "good"] : ""}
                </button>
              ))}
            </div>
          ))}
        </div>
        {lastMove && <p class="muted small">Last move {relTime(lastMove.at)}.</p>}

        {view.status === "finished" && view.moves.length > 0 && (
          <section class="review">
            {review ? (
              <ReviewSummary review={review} view={view} />
            ) : reviewProgress !== null ? (
              <p class="muted">Reviewing with the computer... {reviewProgress}%</p>
            ) : (
              <button class="btn wide" onClick={runReview}>Review this game with the computer</button>
            )}
          </section>
        )}

        {view.status === "active" && (
          <div class="chess-actions">
            {vsCpu ? null : (
              <button class="btn" disabled={busy || view.drawOffer === my} onClick={() => act("offer-draw")}>Offer draw</button>
            )}
            <button class="btn" disabled={busy || view.moves.length === 0 || (!vsCpu && (myTurn || view.takeback === my))}
              title={vsCpu ? "Undo your last move" : "Ask to take back your last move"}
              onClick={() => act("takeback")}>{vsCpu ? "Undo move" : "Ask takeback"}</button>
            <button class="btn" disabled={busy} onClick={() => { if (confirm("Resign this game?")) act("resign"); }}>Resign</button>
          </div>
        )}
        <label class="setting">
          <input type="checkbox" checked={confirmMoves} onChange={(e) => {
            const v = (e.target as HTMLInputElement).checked; setConfirmMoves(v); writeBool(CONFIRM_KEY, v);
          }} />
          Ask me to confirm each move
        </label>
      </div>

      {promo && (
        <div class="modal-back" onClick={() => setPromo(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Promote pawn to">
            <h3>Promote your pawn to</h3>
            <div class="promo-grid">
              {["q", "r", "b", "n"].map((t) => (
                <button key={t} class="btn promo" onClick={() => { makeMove(promo.from, promo.to, t); setPromo(null); }}>
                  <img src={pieceUrl(my, t)} alt={t} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewSummary({ review, view }: { review: Review; view: ChessView }) {
  const rows = (["w", "b"] as Color[]).map((c) => {
    const mine = review.plies.filter((_, i) => (i % 2 === 0 ? "w" : "b") === c);
    const count = (m: Mark) => mine.filter((p) => p.mark === m).length;
    const avgLoss = mine.length ? mine.reduce((s, p) => s + p.loss, 0) / mine.length : 0;
    return {
      name: c === view.myColor ? "You" : (c === "w" ? view.white : view.black).name,
      inacc: count("inaccuracy"), mistake: count("mistake"), blunder: count("blunder"),
      accuracy: Math.max(0, Math.round(100 - avgLoss * 2)),
    };
  });
  return (
    <div>
      <h3 class="review-title">Computer review</h3>
      <table class="review-table">
        <thead><tr><th /><th>Accuracy</th><th class="mark-inaccuracy">?!</th><th class="mark-mistake">?</th><th class="mark-blunder">??</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}><th>{r.name}</th><td>{r.accuracy}%</td><td>{r.inacc}</td><td>{r.mistake}</td><td>{r.blunder}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">?! inaccuracy &middot; ? mistake &middot; ?? blunder. Tap any move to see what the computer suggests.</p>
    </div>
  );
}
