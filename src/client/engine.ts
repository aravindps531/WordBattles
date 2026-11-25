/**
 * Thin wrapper around Stockfish (WebAssembly, runs in a Web Worker in the browser).
 * The engine files are downloaded at build time into /engine (see scripts/fetch-engine.mjs).
 */
const ENGINE_URL = "/engine/stockfish-18-lite-single.js";

export interface SearchResult {
  best: string | null;     // UCI move, null if no legal moves
  cp: number | null;       // centipawns, from the side to move's point of view
  mate: number | null;     // moves to mate (+ = side to move mates)
}

export interface SearchOptions { depth?: number; movetime?: number; skill?: number }

class Engine {
  private worker: Worker;
  private listeners: ((line: string) => void)[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;

  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const l of [...this.listeners]) l(line);
    };
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("The chess engine didn't load.")), 30000);
      this.worker.onerror = () => { clearTimeout(t); reject(new Error("The chess engine couldn't start.")); };
      this.waitFor((l) => l === "uciok").then(() => {
        this.send("isready");
        return this.waitFor((l) => l === "readyok");
      }).then(() => { clearTimeout(t); resolve(); });
      this.send("uci");
    });
  }

  private send(cmd: string) { this.worker.postMessage(cmd); }

  private waitFor(pred: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve) => {
      const fn = (line: string) => {
        onLine?.(line);
        if (pred(line)) {
          this.listeners = this.listeners.filter((x) => x !== fn);
          resolve(line);
        }
      };
      this.listeners.push(fn);
    });
  }

  /** Searches one position. Calls are queued so only one search runs at a time. */
  search(fen: string, opts: SearchOptions): Promise<SearchResult> {
    const run = async (): Promise<SearchResult> => {
      await this.ready;
      this.send(`setoption name Skill Level value ${opts.skill ?? 20}`);
      this.send(`position fen ${fen}`);
      let cp: number | null = null;
      let mate: number | null = null;
      const limits = [
        opts.depth ? `depth ${opts.depth}` : "",
        opts.movetime ? `movetime ${opts.movetime}` : "",
      ].join(" ").trim() || "depth 12";
      this.send(`go ${limits}`);
      const done = await this.waitFor((l) => l.startsWith("bestmove"), (l) => {
        if (!l.startsWith("info") || !l.includes(" score ")) return;
        if (/ multipv (\d+)/.exec(l)?.[1] && / multipv (\d+)/.exec(l)![1] !== "1") return;
        const c = / score cp (-?\d+)/.exec(l);
        const m = / score mate (-?\d+)/.exec(l);
        if (c) { cp = Number(c[1]); mate = null; }
        if (m) { mate = Number(m[1]); cp = null; }
      });
      const best = done.split(" ")[1];
      return { best: best && best !== "(none)" ? best : null, cp, mate };
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}

let instance: Engine | null = null;
export function getEngine(): Engine {
  if (!instance) instance = new Engine();
  return instance;
}

/** Engine settings for each computer level (1 = gentle, 8 = strongest). */
export function levelOptions(level: number): SearchOptions {
  const table: Record<number, SearchOptions> = {
    1: { skill: 0, depth: 1 },
    2: { skill: 2, depth: 2 },
    3: { skill: 5, depth: 3 },
    4: { skill: 8, depth: 5 },
    5: { skill: 11, depth: 8 },
    6: { skill: 14, depth: 10 },
    7: { skill: 17, depth: 13, movetime: 1500 },
    8: { skill: 20, depth: 18, movetime: 2500 },
  };
  return table[level] ?? table[3];
}

/** Win chance (0-100) for the side to move, from an engine score. Same curve Lichess uses. */
export function winChance(cp: number | null, mate: number | null): number {
  const c = mate !== null ? (mate > 0 ? 10000 : -10000) : (cp ?? 0);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}
