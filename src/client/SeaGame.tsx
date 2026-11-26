import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  fits, FLEETS, randomFleet, shipCells, specOf, type Dir, type Salvo, type SeaView, type Ship,
} from "../shared/seabattle";
import type { Api, ApiError } from "./api";
import { ChatPanel, useChat } from "./Chat";
import { HowToButton, HowToPanel, SeaHowTo, useHowTo } from "./HowTo";

const POLL_MS = 15000;
const COLS = "ABCDEFGHIJ";
const cryptoRng = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function cellName(size: number, p: number) {
  return `${COLS[p % size]}${Math.floor(p / size) + 1}`;
}

/** Map of cell -> ship key for a fleet. */
function occupancy(size: number, fleet: Ship[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of fleet) for (const p of shipCells(size, s, specOf(size as 8 | 10, s.key).len)) m.set(p, s.key);
  return m;
}

function Grid({ size, cells, onTap, small, label }: {
  size: number;
  cells: (p: number) => { cls: string; content?: string; title?: string };
  onTap?: (p: number) => void;
  small?: boolean;
  label: string;
}) {
  return (
    <div class={`sgrid ${small ? "small" : ""}`} style={{ "--n": size }} role="grid" aria-label={label}>
      <span />
      {Array.from({ length: size }, (_, c) => <span key={`c${c}`} class="slabel">{COLS[c]}</span>)}
      {Array.from({ length: size }, (_, r) => [
        <span key={`r${r}`} class="slabel">{r + 1}</span>,
        ...Array.from({ length: size }, (_, c) => {
          const p = r * size + c;
          const { cls, content, title } = cells(p);
          return onTap
            ? <button key={p} class={`scell ${cls}`} onClick={() => onTap(p)} aria-label={title ?? cellName(size, p)}>{content}</button>
            : <span key={p} class={`scell ${cls}`} title={title}>{content}</span>;
        }),
      ])}
    </div>
  );
}

export function SeaPage({ api, token, gameId }: { api: Api; token: string; gameId: string }) {
  const [view, setView] = useState<SeaView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [aims, setAims] = useState<number[]>([]);
  // Setup state
  const [draft, setDraft] = useState<Ship[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(() => new URLSearchParams(location.search).has("chat"));
  const versionRef = useRef<number | undefined>(undefined);
  const howTo = useHowTo("sea");

  const applyView = useCallback((v: SeaView) => {
    if (versionRef.current !== v.version) setAims([]);
    versionRef.current = v.version;
    setView(v);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.sea(gameId, versionRef.current);
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

  const vsCpu = !!view && "cpu" in view.them;
  const watching = !!view && "spectator" in view;
  const meId = view && !("cpu" in view.me) ? view.me.id : null;
  const chat = useChat(api, gameId, meId, chatOpen && !vsCpu);
  const size = (view?.size ?? 10) as 8 | 10;
  const specs = FLEETS[size];

  // Select the first ship automatically when setup starts.
  useEffect(() => {
    if (view && !view.myFleet && selected === null && draft.length === 0) setSelected(specs[0].key);
  }, [view?.id, view?.myFleet]);

  const send = async (action: "place" | "fire" | "resign", extra: { fleet?: Ship[]; points?: number[] } = {}) => {
    if (!view) return;
    setBusy(true);
    setMessage(null);
    const before = view.salvos.length;
    try {
      let v: SeaView;
      try {
        v = await api.seaAction(view.id, view.version, action, extra);
      } catch (e) {
        // Both players placing at the same instant: fetch and try once more.
        if (action === "place" && (e as ApiError).status === 409) {
          const fresh = await api.sea(view.id);
          if ("unchanged" in fresh) throw e;
          v = await api.seaAction(view.id, fresh.version, action, extra);
        } else throw e;
      }
      applyView(v);
      if (action === "fire") {
        const mine = v.salvos[before];
        const theirs = v.salvos[before + 1];
        const hits = mine ? mine.shots.filter((s) => s.hit).length : 0;
        const sunk = mine?.shots.filter((s) => s.sunk).map((s) => specOf(size, s.sunk!).name) ?? [];
        let text = `${hits} hit${hits === 1 ? "" : "s"}!${sunk.length ? ` You sank the ${sunk.join(" and ")}!` : ""}`;
        if (theirs && vsCpu) {
          const th = theirs.shots.filter((s) => s.hit).length;
          text += ` The computer fired back: ${th} hit${th === 1 ? "" : "s"}.`;
        }
        setMessage({ kind: "info", text });
      }
    } catch (e) {
      const err = e as ApiError;
      setMessage({ kind: "error", text: err.message });
      if (err.status === 409) { versionRef.current = undefined; await refresh(); }
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- setup helpers
  const draftOcc = useMemo(() => occupancy(size, draft), [draft, size]);
  const placeAt = (key: string, r: number, c: number, prefer: Dir) => {
    const len = specOf(size, key).len;
    const others = draft.filter((s) => s.key !== key);
    const occ = occupancy(size, others);
    for (const dir of [prefer, prefer === "h" ? "v" : "h"] as Dir[]) {
      const ship = { key, r, c, dir };
      if (fits(size, ship, len) && !shipCells(size, ship, len).some((p) => occ.has(p))) return [...others, ship];
    }
    return null;
  };
  const onSetupTap = (p: number) => {
    const r = Math.floor(p / size), c = p % size;
    const there = draftOcc.get(p);
    if (there && there === selected) {
      // Tap the selected ship again: rotate it in place.
      const ship = draft.find((s) => s.key === there)!;
      const next = placeAt(there, ship.r, ship.c, ship.dir === "h" ? "v" : "h");
      if (next && next.find((s) => s.key === there)!.dir !== ship.dir) setDraft(next);
      else setMessage({ kind: "error", text: "No room to turn it there." });
      return;
    }
    if (there) { setSelected(there); setMessage(null); return; }
    if (!selected) return;
    const current = draft.find((s) => s.key === selected);
    const next = placeAt(selected, r, c, current?.dir ?? "h");
    if (!next) { setMessage({ kind: "error", text: "That ship doesn't fit there." }); return; }
    setMessage(null);
    setDraft(next);
    const unplaced = specs.find((sp) => !next.some((s) => s.key === sp.key));
    setSelected(unplaced ? unplaced.key : null);
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

  const theirName = view.them.name;
  const mySalvos = view.salvos.filter((s) => s.by === view.mySeat);
  const theirSalvos = view.salvos.filter((s) => s.by !== view.mySeat);
  const myShots = new Map(mySalvos.flatMap((s) => s.shots.map((x) => [x.p, x] as const)));
  const theirShots = new Map(theirSalvos.flatMap((s) => s.shots.map((x) => [x.p, x] as const)));
  const lastMine = new Set(mySalvos.at(-1)?.shots.map((s) => s.p) ?? []);
  const lastTheirs = new Set(theirSalvos.at(-1)?.shots.map((s) => s.p) ?? []);
  const theirOcc = occupancy(size, view.theirShips);
  const myOcc = occupancy(size, view.myFleet ?? []);
  const sunkTheirs = new Set(mySalvos.flatMap((s) => s.shots.filter((x) => x.sunk).map((x) => x.sunk!)));
  const sunkMine = new Set(theirSalvos.flatMap((s) => s.shots.filter((x) => x.sunk).map((x) => x.sunk!)));
  const result = view.result;
  const iWon = result && result.winner === view.mySeat;

  const header = (
    <>
      <header class="game-top">
        <a class="back" href={`/p/${token}`} aria-label="All games">&larr; Games</a>
        <span class="top-right">
          <span class="muted small">Sea Battle {size}&times;{size}</span>
          <HowToButton onClick={howTo.show} />
          {watching && <span class="watch-tag">Watching</span>}
          {!vsCpu && !watching && (
            <button class="btn chat-btn" onClick={() => setChatOpen(true)} aria-label={chat.unread ? `Chat, ${chat.unread} unread` : "Chat"}>
              Chat{chat.unread > 0 && <span class="badge">{chat.unread}</span>}
            </button>
          )}
        </span>
      </header>
      {howTo.open && <HowToPanel k="sea" title="Sea Battle" onClose={howTo.close}><SeaHowTo /></HowToPanel>}
      {chatOpen && !vsCpu && (
        <ChatPanel messages={chat.messages} meId={meId} onSend={chat.send} onClose={() => {
          setChatOpen(false);
          if (location.search) history.replaceState(null, "", location.pathname);
        }} />
      )}
    </>
  );

  // ---------------------------------------------------------------- setup screen
  if (view.phase === "setup" && !view.myFleet && !watching) {
    const allPlaced = specs.every((sp) => draft.some((s) => s.key === sp.key));
    return (
      <div class="game sea">
        {header}
        <div class="banner mine"><strong>Place your ships.</strong><span class="sub">Tap a ship below, then a square. Tap it again to turn it.</span></div>
        <div class="board-wrap">
          <Grid size={size} label="Your waters" onTap={onSetupTap} cells={(p) => {
            const key = draftOcc.get(p);
            return { cls: key ? `ship ${key === selected ? "sel" : ""}` : "" };
          }} />
        </div>
        <div class="panel">
          <div class="ship-list">
            {specs.map((sp) => {
              const placed = draft.some((s) => s.key === sp.key);
              return (
                <button key={sp.key} class={`ship-chip ${selected === sp.key ? "on" : ""} ${placed ? "placed" : ""}`} onClick={() => setSelected(sp.key)}>
                  <span class="ship-bar">{Array.from({ length: sp.len }, (_, i) => <i key={i} />)}</span>
                  {sp.name}{placed ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          {message && <p class={message.kind === "error" ? "msg error" : "msg info"}>{message.text}</p>}
          <div class="chess-actions">
            <button class="btn" onClick={() => { setDraft(randomFleet(size, cryptoRng)); setSelected(null); setMessage(null); }}>Random fleet</button>
            <button class="btn" disabled={draft.length === 0} onClick={() => { setDraft([]); setSelected(specs[0].key); }}>Clear</button>
            <button class="btn primary" disabled={!allPlaced || busy} onClick={() => send("place", { fleet: draft })}>Ready</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- battle / waiting / finished
  const canAim = !watching && view.phase === "battle" && view.myTurn && !busy;
  const toggleAim = (p: number) => {
    if (!canAim || myShots.has(p)) return;
    setAims((a) => (a.includes(p) ? a.filter((x) => x !== p) : a.length < view.shotsAllowed ? [...a, p] : a));
  };

  const fleetStatus = (keys: Set<string>, title: string) => (
    <div class="fleet-status">
      <span class="muted small">{title}</span>
      {specs.map((sp) => (
        <span key={sp.key} class={`fs-ship ${keys.has(sp.key) ? "sunk" : ""}`}>
          <span class="ship-bar">{Array.from({ length: sp.len }, (_, i) => <i key={i} />)}</span>
        </span>
      ))}
    </div>
  );

  const salvoText = (s: Salvo, i: number) => {
    const who = watching ? (s.by === 0 ? view.me.name : theirName) : s.by === view.mySeat ? "You" : theirName;
    const hits = s.shots.filter((x) => x.hit).length;
    const sunk = s.shots.filter((x) => x.sunk).map((x) => specOf(size, x.sunk!).name);
    return `${i + 1}. ${who}: ${s.shots.length} shot${s.shots.length === 1 ? "" : "s"}, ${hits} hit${hits === 1 ? "" : "s"}`
      + (sunk.length ? ` — sank ${watching || s.by === view.mySeat ? "the" : "your"} ${sunk.join(" and ")}` : "");
  };

  return (
    <div class="game sea">
      {header}
      {watching ? (
        <div class="banner watching">
          <strong>{view.me.name} vs {theirName}</strong>
          <span class="sub">{view.phase === "finished" ? (result?.winner === null ? "Draw." : `${(result?.winner === 0 ? view.me : view.them).name} won.`)
            : view.phase === "setup" ? "Players are placing their ships." : `${(view.salvos.length % 2 === 0) === view.iAmFirst ? view.me.name : theirName} to fire.`}</span>
        </div>
      ) : view.phase === "finished" ? (
        <div class={`banner done ${iWon ? "won" : ""}`}>
          <strong>{result?.winner === null ? "It's a draw!" : iWon ? "You won!" : `${theirName} won.`}</strong>
          <span class="sub">{result?.reason === "resigned" ? (iWon ? `${theirName} resigned.` : "You resigned.") : result?.winner === null ? "Both fleets sank with equal turns." : "All ships sunk."}</span>
        </div>
      ) : view.phase === "setup" ? (
        <div class="banner waiting"><strong>Waiting for {theirName}</strong><span class="sub">to place their ships.</span></div>
      ) : view.myTurn ? (
        <div class="banner mine" aria-live="polite">
          <strong>{view.lastChance ? "Last chance!" : "Your turn!"}</strong>
          <span class="sub">{view.lastChance ? `${theirName} sank your fleet. Sink theirs with this salvo to draw.` : `Fire ${view.shotsAllowed} shot${view.shotsAllowed === 1 ? "" : "s"} at ${theirName}'s waters.`}</span>
        </div>
      ) : (
        <div class="banner waiting" aria-live="polite">
          <strong>{theirName}'s turn.</strong>
          <span class="sub">{view.lastChance ? "You sank their fleet! They get one last salvo." : "Waiting for their salvo."}</span>
        </div>
      )}

      <div class="board-wrap sea-boards">
        <div class="sea-col">
          <h3 class="grid-title">{theirName}'s waters</h3>
          <Grid size={size} label={`${theirName}'s waters`} onTap={toggleAim} cells={(p) => {
            const shot = myShots.get(p);
            const ship = theirOcc.has(p);
            const aimed = aims.includes(p);
            const cls = [
              ship ? "ship revealed" : "",
              shot ? (shot.hit ? "hit" : "miss") : "",
              aimed ? "aim" : "",
              lastMine.has(p) ? "recent" : "",
              canAim && !shot ? "aimable" : "",
            ].join(" ");
            return { cls, content: shot ? (shot.hit ? "✕" : "•") : aimed ? "◎" : "" };
          }} />
          {view.phase !== "setup" && fleetStatus(sunkTheirs, "Their fleet:")}
        </div>
        <div class="sea-col mine">
          <h3 class="grid-title">{watching ? `${view.me.name}'s waters` : "Your fleet"}</h3>
          <Grid size={size} small label="Your fleet" cells={(p) => {
            const shot = theirShots.get(p);
            const cls = [myOcc.has(p) ? "ship" : "", shot ? (shot.hit ? "hit" : "miss") : "", lastTheirs.has(p) ? "recent" : ""].join(" ");
            return { cls, content: shot ? (shot.hit ? "✕" : "•") : "" };
          }} />
          {view.phase !== "setup" && fleetStatus(sunkMine, watching ? `${view.me.name}'s fleet:` : "Your fleet:")}
        </div>
      </div>

      <div class="panel">
        {view.phase === "battle" && view.myTurn && (
          <div class="actions two">
            <button class="btn" disabled={aims.length === 0} onClick={() => setAims([])}>Clear aim</button>
            <button class="btn primary" disabled={busy || aims.length !== view.shotsAllowed} onClick={() => send("fire", { points: aims })}>
              {aims.length === view.shotsAllowed ? `Fire ${aims.length} shot${aims.length === 1 ? "" : "s"}!` : `Aim ${view.shotsAllowed - aims.length} more`}
            </button>
          </div>
        )}
        {message && <p class={message.kind === "error" ? "msg error" : "msg info"} role="status">{message.text}</p>}
        {view.salvos.length > 0 && (
          <details class="history" open>
            <summary>Salvos ({view.salvos.length})</summary>
            <ul class="salvo-log">
              {[...view.salvos].map((s, i) => ({ s, i })).reverse().slice(0, 30).map(({ s, i }) => (
                <li key={i}>{salvoText(s, i)} <span class="muted">&middot; {relTime(s.at)}</span></li>
              ))}
            </ul>
          </details>
        )}
        {view.phase !== "finished" && !watching && (
          <p class="leave">
            <button class="link-btn" onClick={() => { if (confirm("Resign this game?")) send("resign"); }}>Resign</button>
          </p>
        )}
      </div>
    </div>
  );
}
