import {
  bagFor, BLANK, rulesFor, SCORELESS_TURN_LIMIT, TILE_POINTS, type Rules, type Variant,
} from "./constants";

/** A tile on the board. `b` marks a blank standing in for letter `l`. */
export interface Cell { l: string; b?: true }
export type Board = (Cell | null)[][];

/** A tile the current player is placing this turn. */
export interface PlacedTile { r: number; c: number; l: string; b?: boolean }

export interface WordScore { w: string; s: number }

export type MoveKind = "play" | "exchange" | "pass" | "resign";

export interface Move {
  seat: number;
  kind: MoveKind;
  score: number;
  at: number;
  words?: WordScore[];
  tiles?: PlacedTile[];
  bingo?: boolean;
  count?: number; // tiles exchanged
}

export interface EndSummary {
  reason: "out" | "scoreless" | "resigned";
  /** Points added/subtracted per seat for tiles left on racks. */
  adjustments: number[];
  winners: number[]; // seat indexes
}

export interface GameState {
  v: 1;
  variant?: Variant;        // absent = standard (games created before Mega existed)
  seats: string[];          // player ids, in turn order
  names: string[];          // display names, by seat
  board: Board;
  bag: string[];
  racks: string[][];        // by seat
  scores: number[];         // by seat
  resigned: boolean[];      // by seat
  turn: number;             // seat index whose turn it is
  scorelessStreak: number;
  status: "active" | "finished";
  end?: EndSummary;
  moves: Move[];
}

export type Rng = (n: number) => number; // returns integer in [0, n)

export class MoveError extends Error {}

// ---------------------------------------------------------------- board utils

export function emptyBoard(size = 15): Board {
  return Array.from({ length: size }, () => Array<Cell | null>(size).fill(null));
}

export function isBoardEmpty(board: Board): boolean {
  return board.every((row) => row.every((c) => c === null));
}

export function rulesOf(g: { variant?: Variant }): Rules {
  return rulesFor(g.variant);
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function rackValue(rack: string[]): number {
  return rack.reduce((sum, t) => sum + TILE_POINTS[t], 0);
}

// ------------------------------------------------------- placement & scoring

export interface FormedWord {
  word: string;
  score: number;
  cells: { r: number; c: number }[];
}

export interface PlacementResult {
  words: FormedWord[];
  score: number;
  bingo: boolean;
}

/**
 * Validates the geometry of a placement and computes the words it forms and
 * their scores. Does NOT check words against the dictionary.
 * Throws MoveError with a player-friendly message when the placement is illegal.
 */
export function evaluatePlacement(board: Board, tiles: PlacedTile[], rules: Rules = rulesFor("standard")): PlacementResult {
  const size = board.length;
  const inBounds = (r: number, c: number) => r >= 0 && r < size && c >= 0 && c < size;
  if (tiles.length === 0) throw new MoveError("Place at least one tile.");
  if (tiles.length > rules.rackSize) throw new MoveError("Too many tiles.");

  const placed = new Map<string, PlacedTile>();
  for (const t of tiles) {
    if (!Number.isInteger(t.r) || !Number.isInteger(t.c) || !inBounds(t.r, t.c)) {
      throw new MoveError("Tile is off the board.");
    }
    if (!/^[A-Z]$/.test(t.l)) throw new MoveError("Choose a letter for the blank tile.");
    if (board[t.r][t.c]) throw new MoveError("That square is already taken.");
    const key = `${t.r},${t.c}`;
    if (placed.has(key)) throw new MoveError("Two tiles on the same square.");
    placed.set(key, t);
  }

  const sameRow = tiles.every((t) => t.r === tiles[0].r);
  const sameCol = tiles.every((t) => t.c === tiles[0].c);
  if (!sameRow && !sameCol) {
    throw new MoveError("Tiles must be in a single row or column.");
  }

  const at = (r: number, c: number): Cell | PlacedTile | null => {
    if (!inBounds(r, c)) return null;
    return board[r][c] ?? placed.get(`${r},${c}`) ?? null;
  };

  // Contiguity: no gaps between the first and last new tile.
  if (tiles.length > 1) {
    if (sameRow) {
      const r = tiles[0].r;
      const cs = tiles.map((t) => t.c);
      for (let c = Math.min(...cs); c <= Math.max(...cs); c++) {
        if (!at(r, c)) throw new MoveError("Tiles must form one connected line with no gaps.");
      }
    } else {
      const c = tiles[0].c;
      const rs = tiles.map((t) => t.r);
      for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
        if (!at(r, c)) throw new MoveError("Tiles must form one connected line with no gaps.");
      }
    }
  }

  const first = isBoardEmpty(board);
  if (first) {
    if (!placed.has(`${rules.center},${rules.center}`)) {
      throw new MoveError("The first word must cover the centre star.");
    }
  } else {
    const touches = tiles.some(({ r, c }) =>
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(
        ([rr, cc]) => inBounds(rr, cc) && board[rr][cc] !== null,
      ),
    );
    if (!touches) throw new MoveError("New tiles must connect to tiles already on the board.");
  }

  const wordAt = (r0: number, c0: number, dr: number, dc: number): FormedWord | null => {
    let r = r0, c = c0;
    while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
    const cells: { r: number; c: number }[] = [];
    let letters = "";
    let sum = 0;
    let mult = 1;
    while (at(r, c)) {
      const cell = at(r, c)!;
      const isNew = placed.has(`${r},${c}`);
      let pts = cell.b ? 0 : TILE_POINTS[cell.l];
      if (isNew) {
        const p = rules.premiums[r][c];
        if (p === "DL") pts *= 2;
        else if (p === "TL") pts *= 3;
        else if (p === "QL") pts *= 4;
        else if (p === "DW") mult *= 2;
        else if (p === "TW") mult *= 3;
        else if (p === "QW") mult *= 4;
      }
      sum += pts;
      letters += cell.l;
      cells.push({ r, c });
      r += dr; c += dc;
    }
    if (cells.length < 2) return null;
    return { word: letters, score: sum * mult, cells };
  };

  // Main direction: along the line of tiles. For a single tile, whichever
  // direction(s) form a word.
  const words: FormedWord[] = [];
  const t0 = tiles[0];
  let horizontal: boolean;
  if (tiles.length > 1) horizontal = sameRow;
  else horizontal = !!(at(t0.r, t0.c - 1) || at(t0.r, t0.c + 1));

  const main = horizontal ? wordAt(t0.r, t0.c, 0, 1) : wordAt(t0.r, t0.c, 1, 0);
  if (main) words.push(main);
  for (const t of tiles) {
    const cross = horizontal ? wordAt(t.r, t.c, 1, 0) : wordAt(t.r, t.c, 0, 1);
    if (cross) words.push(cross);
  }
  if (words.length === 0) throw new MoveError("A word must be at least two letters long.");

  const bingo = tiles.length === rules.rackSize;
  const score = words.reduce((s, w) => s + w.score, 0) + (bingo ? rules.bingoBonus : 0);
  return { words, score, bingo };
}

// ------------------------------------------------------------- game lifecycle

export function createGame(players: { id: string; name: string }[], rng: Rng, variant: Variant = "standard"): GameState {
  const rules = rulesFor(variant);
  if (players.length < 2 || players.length > 4) {
    throw new MoveError("A game needs 2 to 4 players.");
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new MoveError("Each player can only be in a game once.");
  }
  const order = shuffle([...players], rng); // random starting order
  const bag = shuffle(bagFor(rules), rng);
  const racks = order.map(() => bag.splice(0, rules.rackSize));
  return {
    v: 1,
    ...(variant === "standard" ? {} : { variant }),
    seats: order.map((p) => p.id),
    names: order.map((p) => p.name),
    board: emptyBoard(rules.size),
    bag,
    racks,
    scores: order.map(() => 0),
    resigned: order.map(() => false),
    turn: 0,
    scorelessStreak: 0,
    status: "active",
    moves: [],
  };
}

export function activeSeats(g: GameState): number[] {
  return g.seats.map((_, i) => i).filter((i) => !g.resigned[i]);
}

export function nextSeat(g: GameState, from: number): number {
  const n = g.seats.length;
  for (let k = 1; k <= n; k++) {
    const s = (from + k) % n;
    if (!g.resigned[s]) return s;
  }
  return from;
}

function assertTurn(g: GameState, seat: number) {
  if (g.status !== "active") throw new MoveError("This game has finished.");
  if (seat !== g.turn) throw new MoveError("It is not your turn.");
}

/** Removes tiles from a rack; blanks are '?'. Returns the new rack or throws. */
function takeFromRack(rack: string[], needed: string[]): string[] {
  const left = [...rack];
  for (const t of needed) {
    const i = left.indexOf(t);
    if (i < 0) throw new MoveError("You don't have those tiles.");
    left.splice(i, 1);
  }
  return left;
}

function advance(g: GameState) {
  g.turn = nextSeat(g, g.turn);
}

function finish(g: GameState, reason: EndSummary["reason"], outSeat?: number) {
  const adjustments = g.seats.map(() => 0);
  if (reason === "out" && outSeat !== undefined) {
    let bonus = 0;
    for (const s of activeSeats(g)) {
      if (s === outSeat) continue;
      const v = rackValue(g.racks[s]);
      adjustments[s] -= v;
      bonus += v;
    }
    adjustments[outSeat] += bonus;
  } else if (reason === "scoreless") {
    for (const s of activeSeats(g)) adjustments[s] -= rackValue(g.racks[s]);
  }
  g.scores = g.scores.map((s, i) => s + adjustments[i]);
  const contenders = activeSeats(g);
  const best = Math.max(...contenders.map((s) => g.scores[s]));
  g.end = {
    reason,
    adjustments,
    winners: contenders.filter((s) => g.scores[s] === best),
  };
  g.status = "finished";
}

function afterScoreless(g: GameState) {
  g.scorelessStreak += 1;
  if (g.scorelessStreak >= SCORELESS_TURN_LIMIT) finish(g, "scoreless");
  else advance(g);
}

export interface PlayOptions {
  isWord: (w: string) => boolean;
  now?: number;
}

/** Applies a play. Throws MoveError on illegal moves or invalid words. */
export function applyPlay(g: GameState, seat: number, tiles: PlacedTile[], opts: PlayOptions): Move {
  assertTurn(g, seat);
  const norm = tiles.map((t) => ({
    r: t.r, c: t.c, l: String(t.l ?? "").toUpperCase(), ...(t.b ? { b: true } : {}),
  }));
  const rackAfter = takeFromRack(g.racks[seat], norm.map((t) => (t.b ? BLANK : t.l)));
  const rules = rulesOf(g);
  const result = evaluatePlacement(g.board, norm, rules);
  const bad = result.words.filter((w) => !opts.isWord(w.word)).map((w) => w.word);
  if (bad.length) {
    throw new MoveError(
      `${bad.length > 1 ? "Not valid words" : "Not a valid word"}: ${[...new Set(bad)].join(", ")}`,
    );
  }

  for (const t of norm) g.board[t.r][t.c] = t.b ? { l: t.l, b: true } : { l: t.l };
  const drawn = g.bag.splice(0, rules.rackSize - rackAfter.length);
  g.racks[seat] = [...rackAfter, ...drawn];
  g.scores[seat] += result.score;

  const move: Move = {
    seat, kind: "play", score: result.score, at: opts.now ?? Date.now(),
    words: result.words.map((w) => ({ w: w.word, s: w.score })),
    tiles: norm, ...(result.bingo ? { bingo: true } : {}),
  };
  g.moves.push(move);

  if (g.racks[seat].length === 0 && g.bag.length === 0) {
    finish(g, "out", seat);
  } else if (result.score === 0) {
    afterScoreless(g);
  } else {
    g.scorelessStreak = 0;
    advance(g);
  }
  return move;
}

export function applyExchange(g: GameState, seat: number, letters: string[], rng: Rng, now = Date.now()): Move {
  assertTurn(g, seat);
  if (letters.length === 0) throw new MoveError("Choose tiles to exchange.");
  const { rackSize } = rulesOf(g);
  if (g.bag.length < rackSize) {
    throw new MoveError(`You can only exchange when the bag has at least ${rackSize} tiles.`);
  }
  const norm = letters.map((l) => (l === BLANK ? BLANK : String(l).toUpperCase()));
  const kept = takeFromRack(g.racks[seat], norm);
  const drawn = g.bag.splice(0, norm.length);
  g.bag.push(...norm);
  shuffle(g.bag, rng);
  g.racks[seat] = [...kept, ...drawn];
  const move: Move = { seat, kind: "exchange", score: 0, at: now, count: norm.length };
  g.moves.push(move);
  afterScoreless(g);
  return move;
}

export function applyPass(g: GameState, seat: number, now = Date.now()): Move {
  assertTurn(g, seat);
  const move: Move = { seat, kind: "pass", score: 0, at: now };
  g.moves.push(move);
  afterScoreless(g);
  return move;
}

/** A player leaves the game. Allowed at any time, not only on their turn. */
export function applyResign(g: GameState, seat: number, now = Date.now()): Move {
  if (g.status !== "active") throw new MoveError("This game has finished.");
  if (g.resigned[seat]) throw new MoveError("You have already left this game.");
  g.resigned[seat] = true;
  const move: Move = { seat, kind: "resign", score: 0, at: now };
  g.moves.push(move);
  if (activeSeats(g).length <= 1) {
    finish(g, "resigned");
  } else if (g.turn === seat) {
    advance(g);
  }
  return move;
}

// ------------------------------------------------------------ player view

export interface GameView {
  id: string;
  version: number;
  variant: Variant;
  seats: { id: string; name: string; score: number; tiles: number; resigned: boolean }[];
  mySeat: number | null;
  myRack: string[];
  board: Board;
  bagCount: number;
  turn: number;
  nextTurn: number;
  status: GameState["status"];
  end?: EndSummary;
  moves: Move[];
  scorelessStreak: number;
}

/** Strips hidden information (other racks, bag order) for one player. */
export function viewFor(g: GameState, playerId: string, id: string, version: number): GameView {
  const mySeat = g.seats.indexOf(playerId);
  return {
    id,
    version,
    variant: g.variant ?? "standard",
    seats: g.seats.map((pid, i) => ({
      id: pid, name: g.names[i], score: g.scores[i], tiles: g.racks[i].length, resigned: g.resigned[i],
    })),
    mySeat: mySeat >= 0 ? mySeat : null,
    myRack: mySeat >= 0 ? g.racks[mySeat] : [],
    board: g.board,
    bagCount: g.bag.length,
    turn: g.turn,
    nextTurn: nextSeat(g, g.turn),
    status: g.status,
    end: g.end,
    moves: g.moves,
    scorelessStreak: g.scorelessStreak,
  };
}
