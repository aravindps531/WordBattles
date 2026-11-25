import { useCallback, useEffect, useState } from "preact/hooks";
import { Api, type AnySummary, type ChessSummary, type GameSummary, type MeResponse } from "./api";
import { enablePush, isIOS, isStandalone, pushState, syncSubscription, type PushState } from "./push";

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function HomePage({ api, token }: { api: Api; token: string }) {
  const [data, setData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.me().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [api]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  if (error && !data) {
    return (
      <div class="page">
        <h1 class="title">Sarathys' Game Room</h1>
        <p class="error-box">{error}</p>
      </div>
    );
  }
  if (!data) return <div class="page"><p class="muted center">Loading...</p></div>;

  const needsMe = (g: AnySummary) => g.myTurn || !!g.unreadChat || (g.kind === "chess" && (g.pending !== null || g.cpuTurn));
  const active = data.games.filter((g) => g.status === "active");
  const mine = active.filter(needsMe);
  const waiting = active.filter((g) => !needsMe(g));
  const finished = data.games.filter((g) => g.status === "finished").slice(0, 10);
  const myTurnCount = active.filter((g) => g.myTurn).length;

  return (
    <div class="page">
      <h1 class="title">Sarathys' Game Room</h1>
      <p class="hello">Hello, <b>{data.me.name}</b>{myTurnCount ? `. It's your turn in ${myTurnCount} game${myTurnCount > 1 ? "s" : ""}.` : "."}</p>

      <NotificationsCard api={api} />

      {mine.length > 0 && <Section title="Your turn" games={mine} token={token} meId={data.me.id} />}
      {waiting.length > 0 && <Section title="Waiting for others" games={waiting} token={token} meId={data.me.id} />}
      {active.length === 0 && <p class="muted">No games in progress. Start one below.</p>}

      <NewGame api={api} token={token} family={data.family} />

      {finished.length > 0 && <Section title="Finished" games={finished} token={token} meId={data.me.id} />}

      <p class="muted small center footer-note">
        Keep this page's link private: it signs you in. Word Battles checks words against the Collins (UK/India) and North American word lists.
      </p>
    </div>
  );
}

function NewGame({ api, token, family }: { api: Api; token: string; family: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<"words" | "chess">("words");
  const [picking, setPicking] = useState<Set<string>>(new Set());
  const [opponent, setOpponent] = useState<string>("");
  const [level, setLevel] = useState(3);
  const [color, setColor] = useState<"random" | "w" | "b">("random");
  const [creating, setCreating] = useState(false);

  const startWords = async () => {
    setCreating(true);
    try {
      const { id } = await api.createGame([...picking]);
      location.href = `/p/${token}/g/${id}`;
    } catch (e) { alert((e as Error).message); setCreating(false); }
  };
  const startChess = async () => {
    setCreating(true);
    try {
      const { id } = await api.createChess(
        opponent === "cpu" ? { cpuLevel: level, color } : { opponentId: opponent, color },
      );
      location.href = `/p/${token}/c/${id}`;
    } catch (e) { alert((e as Error).message); setCreating(false); }
  };

  return (
    <section class="card">
      <h2>Start a new game</h2>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={kind === "words"} class={`tab ${kind === "words" ? "on" : ""}`} onClick={() => setKind("words")}>Word Battles</button>
        <button role="tab" aria-selected={kind === "chess"} class={`tab ${kind === "chess" ? "on" : ""}`} onClick={() => setKind("chess")}>Chess</button>
      </div>

      {kind === "words" ? (
        family.length === 0 ? <p class="muted">No other players yet. Add them on the admin page.</p> : (
          <>
            <p class="muted small">Pick 1 to 3 people. The starting order is drawn at random.</p>
            <div class="pick">
              {family.map((p) => (
                <label key={p.id} class={`chip ${picking.has(p.id) ? "on" : ""}`}>
                  <input type="checkbox" checked={picking.has(p.id)} disabled={!picking.has(p.id) && picking.size >= 3}
                    onChange={() => setPicking((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                  {p.name}
                </label>
              ))}
            </div>
            <button class="btn primary wide" disabled={picking.size === 0 || creating} onClick={startWords}>
              {creating ? "Starting..." : `Start Word Battle${picking.size ? ` with ${picking.size + 1} players` : ""}`}
            </button>
          </>
        )
      ) : (
        <>
          <p class="muted small">Play against</p>
          <div class="pick">
            {family.map((p) => (
              <label key={p.id} class={`chip ${opponent === p.id ? "on" : ""}`}>
                <input type="radio" name="opp" checked={opponent === p.id} onChange={() => setOpponent(p.id)} />
                {p.name}
              </label>
            ))}
            <label class={`chip ${opponent === "cpu" ? "on" : ""}`}>
              <input type="radio" name="opp" checked={opponent === "cpu"} onChange={() => setOpponent("cpu")} />
              Computer
            </label>
          </div>
          {opponent === "cpu" && (
            <label class="field small-field">Computer level: {level} {level <= 2 ? "(gentle)" : level >= 7 ? "(very strong)" : ""}
              <input type="range" min={1} max={8} value={level} onInput={(e) => setLevel(Number((e.target as HTMLInputElement).value))} />
            </label>
          )}
          <p class="muted small">Your colour</p>
          <div class="pick">
            {([["random", "Random"], ["w", "White"], ["b", "Black"]] as const).map(([v, label]) => (
              <label key={v} class={`chip ${color === v ? "on" : ""}`}>
                <input type="radio" name="color" checked={color === v} onChange={() => setColor(v)} />
                {label}
              </label>
            ))}
          </div>
          <button class="btn primary wide" disabled={!opponent || creating} onClick={startChess}>
            {creating ? "Starting..." : "Start chess game"}
          </button>
        </>
      )}
    </section>
  );
}

function Section({ title, games, token, meId }: { title: string; games: AnySummary[]; token: string; meId: string }) {
  return (
    <section>
      <h2 class="section-title">{title}</h2>
      <ul class="games">
        {games.map((g) => (
          <li key={g.id}>{g.kind === "chess" ? <ChessCard g={g as ChessSummary & { unreadChat?: number }} token={token} /> : <WordsCard g={g as GameSummary & { unreadChat?: number }} token={token} meId={meId} />}</li>
        ))}
      </ul>
    </section>
  );
}

function ChessCard({ g, token }: { g: ChessSummary & { unreadChat?: number }; token: string }) {
  const attention = g.myTurn || g.pending !== null || g.cpuTurn;
  const status = g.status === "finished"
    ? (g.result === "1/2-1/2" ? "Draw" : (g.result === "1-0") === (g.myColor === "w") ? "You won" : `${g.opponent} won`)
    : g.pending === "draw" ? "Draw offered"
    : g.pending === "takeback" ? "Takeback asked"
    : g.myTurn ? "Your move"
    : g.cpuTurn ? "Computer's move"
    : `${g.turnName}'s move`;
  return (
    <a class={`game-card ${attention ? "mine" : ""}`} href={`/p/${token}/c/${g.id}`}>
      <div class="gc-head">
        <span class="gc-title"><span class="kind-icon" aria-hidden="true">&#9822;</span> Chess vs {g.opponent}</span>
        <span class={`gc-status ${attention && g.status === "active" ? "mine" : ""}`}>{status}</span>
      </div>
      <div class="gc-scores">
        <span>You play <b>{g.myColor === "w" ? "White" : "Black"}</b></span>
        <span>Move {g.moveNumber}</span>
      </div>
      {(g.endText || g.lastMove) && (
        <div class="gc-last muted small">{g.endText ?? g.lastMove} &middot; {relTime(g.updatedAt)}</div>
      )}
      {!!g.unreadChat && <div class="gc-chat">{g.unreadChat} new message{g.unreadChat > 1 ? "s" : ""}</div>}
    </a>
  );
}

function WordsCard({ g, token, meId }: { g: GameSummary & { unreadChat?: number }; token: string; meId: string }) {
  const others = g.players.filter((p) => p.id !== meId).map((p) => p.name);
  const turnPlayer = g.players[g.turn];
  return (
    <a class={`game-card ${g.myTurn ? "mine" : ""}`} href={`/p/${token}/g/${g.id}`}>
      <div class="gc-head">
        <span class="gc-title"><span class="kind-icon" aria-hidden="true">W</span> Words with {others.join(", ")}</span>
        <span class={`gc-status ${g.myTurn ? "mine" : ""}`}>
          {g.status === "finished"
            ? `${g.winners.map((w) => (g.players[w].id === meId ? "You" : g.players[w].name)).join(" & ")} won`
            : g.myTurn ? "Your turn" : `${turnPlayer.name}'s turn`}
        </span>
      </div>
      <div class="gc-scores">
        {g.players.map((p, i) => (
          <span key={p.id} class={`gc-score ${g.status === "active" && i === g.turn ? "turn" : ""}`}>
            {p.id === meId ? "You" : p.name} <b>{p.score}</b>
          </span>
        ))}
      </div>
      {g.lastMove && <div class="gc-last muted small">{g.lastMove} &middot; {relTime(g.updatedAt)}</div>}
      {!!g.unreadChat && <div class="gc-chat">{g.unreadChat} new message{g.unreadChat > 1 ? "s" : ""}</div>}
    </a>
  );
}

function NotificationsCard({ api }: { api: Api }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    pushState().then((s) => {
      setState(s);
      if (s === "granted") syncSubscription(api).catch(() => {});
    });
  }, [api]);

  if (!state || state === "unconfigured") return null;

  if (state === "granted") {
    return (
      <p class="muted small notif-ok">
        Notifications are on for this device.{" "}
        <button class="link-btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await syncSubscription(api); await api.testPush(); setNote("Test sent. It should arrive in a few seconds."); }
          catch (e) { setNote((e as Error).message); }
          setBusy(false);
        }}>Send a test</button>
        {note && <span> {note}</span>}
      </p>
    );
  }

  return (
    <section class="card notif">
      <h2>Get told when it's your turn</h2>
      {state === "ios-install" && (
        <ol class="steps">
          <li>Tap the <b>Share</b> button in Safari (the square with an arrow).</li>
          <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open <b>Word Battles</b> from your home screen and come back here to turn on notifications.</li>
        </ol>
      )}
      {state === "unsupported" && (
        <p class="muted">This browser can't show notifications. On Android use Chrome; on iPhone or iPad, add this page to your home screen from Safari.</p>
      )}
      {state === "denied" && (
        <p class="muted">Notifications are blocked for this site. Turn them on in your browser or device settings for this site, then reload.</p>
      )}
      {state === "default" && (
        <>
          <p class="muted">We'll send a notification when someone plays and it's your turn.</p>
          <button class="btn primary wide" disabled={busy} onClick={async () => {
            setBusy(true);
            try { setState(await enablePush(api)); } catch (e) { setNote((e as Error).message); }
            setBusy(false);
          }}>Turn on notifications</button>
          {isIOS() && !isStandalone() && <p class="muted small">Tip: add this page to your home screen first.</p>}
          {note && <p class="msg error">{note}</p>}
        </>
      )}
    </section>
  );
}
