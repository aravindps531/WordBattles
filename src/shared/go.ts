/**
 * Go rules: captures, no suicide, positional superko, area (Chinese) scoring,
 * handicap stones, and an end-of-game phase where players agree on dead stones.
 *
 * The board is a string of size*size characters: "." empty, "b" black, "w" white,
 * indexed row-major from the top-left corner.
 */

export type GoColor = "b" | "w";
export type GoSize = 9 | 13;
export interface GoPlayer { id: string; name: string }

export interface GoMove {
  color: GoColor;
  point: number | null; // null = pass
  captured: number;     // stones captured by this move
  at: number;
}

export interface GoScore {
  black: number;        // stones + territory
  white: number;        // stones + territory + komi
  blackTerritory: number[];
  whiteTerritory: number[];
}

export interface GoState {
  v: 1;
  kind: "go";
  size: GoSize;
  black: GoPlayer;
  white: GoPlayer;
  komi: number;
  handicap: number;
  /** boards[0] is the start position; boards[i+1] is the position after moves[i]. */
  boards: string[];
  moves: GoMove[];
  prisoners: { b: number; w: number }; // stones captured BY each colour
  phase: "play" | "scoring" | "finished";
  dead: number[];               // points marked dead during scoring
  accepted: GoColor[];          // who has accepted the current dead-stone marking
  takeback: GoColor | null;
  result?: { winner: GoColor; margin: number | null; reason: "score" | "resigned"; black?: number; white?: number };
}

export class GoError extends Error {}

export const SIZES: GoSize[] = [9, 13];
export const MAX_HANDICAP: Record<GoSize, number> = { 9: 5, 13: 9 };
export const KOMI = 7.5;
export const HANDICAP_KOMI = 0.5;
const LETTERS = "ABCDEFGHJKLMNOPQRST"; // Go coordinates skip "I"

export const other = (c: GoColor): GoColor => (c === "b" ? "w" : "b");

export function pointName(size: number, p: number): string {
  return `${LETTERS[p % size]}${size - Math.floor(p / size)}`;
}

export function starPoints(size: GoSize): number[] {
  const lo = size === 9 ? 2 : 3;
  const hi = size - 1 - lo;
  const mid = (size - 1) / 2;
  return [[lo, lo], [lo, hi], [hi, lo], [hi, hi], [mid, mid]].map(([r, c]) => r * size + c);
}

/** Standard handicap stone placement (rows from the top, Black's point of view). */
export function handicapPoints(size: GoSize, n: number): number[] {
  if (n < 2) return [];
  const lo = size === 9 ? 2 : 3;
  const hi = size - 1 - lo;
  const mid = (size - 1) / 2;
  const at = (r: number, c: number) => r * size + c;
  const corners = [at(lo, hi), at(hi, lo), at(hi, hi), at(lo, lo)];
  const center = at(mid, mid);
  const sides = [at(mid, lo), at(mid, hi), at(lo, mid), at(hi, mid)];
  switch (n) {
    case 2: return corners.slice(0, 2);
    case 3: return corners.slice(0, 3);
    case 4: return corners;
    case 5: return [...corners, center];
    case 6: return [...corners, ...sides.slice(0, 2)];
    case 7: return [...corners, ...sides.slice(0, 2), center];
    case 8: return [...corners, ...sides];
    default: return [...corners, ...sides, center];
  }
}

export function neighbors(size: number, p: number): number[] {
  const r = Math.floor(p / size), c = p % size;
  const out: number[] = [];
  if (r > 0) out.push(p - size);
  if (r < size - 1) out.push(p + size);
  if (c > 0) out.push(p - 1);
  if (c < size - 1) out.push(p + 1);
  return out;
}

/** The connected group containing p and its liberties. */
export function groupAt(board: string, size: number, p: number): { stones: number[]; liberties: Set<number> } {
  const color = board[p];
  const stones: number[] = [];
  const liberties = new Set<number>();
  if (color === ".") return { stones, liberties };
  const seen = new Set([p]);
  const stack = [p];
  while (stack.length) {
    const q = stack.pop()!;
    stones.push(q);
    for (const n of neighbors(size, q)) {
      if (board[n] === ".") liberties.add(n);
      else if (board[n] === color && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return { stones, liberties };
}

function setAt(board: string, p: number, ch: string): string {
  return board.slice(0, p) + ch + board.slice(p + 1);
}

/** Result of placing a stone, or an error message. Does not check superko. */
export function tryPlace(board: string, size: number, color: GoColor, p: number):
  { board: string; captured: number } | { error: string } {
  if (!Number.isInteger(p) || p < 0 || p >= size * size) return { error: "That point is off the board." };
  if (board[p] !== ".") return { error: "That point is already taken." };
  let b = setAt(board, p, color);
  let captured = 0;
  const opp = other(color);
  for (const n of neighbors(size, p)) {
    if (b[n] !== opp) continue;
    const g = groupAt(b, size, n);
    if (g.liberties.size === 0) {
      for (const s of g.stones) b = setAt(b, s, ".");
      captured += g.stones.length;
    }
  }
  if (groupAt(b, size, p).liberties.size === 0) return { error: "You can't play there: your stones would have no liberties." };
  return { board: b, captured };
}

export function currentBoard(g: GoState): string {
  return g.boards[g.boards.length - 1];
}

export function turnOf(g: GoState): GoColor {
  // Black moves first, except in handicap games where White moves first.
  const first: GoColor = g.handicap >= 2 ? "w" : "b";
  return g.moves.length % 2 === 0 ? first : other(first);
}

export function colorOf(g: GoState, playerId: string): GoColor | null {
  if (g.black.id === playerId) return "b";
  if (g.white.id === playerId) return "w";
  return null;
}

export function playerOf(g: GoState, c: GoColor): GoPlayer {
  return c === "b" ? g.black : g.white;
}

export function trailingPasses(g: GoState): number {
  let n = 0;
  for (let i = g.moves.length - 1; i >= 0 && g.moves[i].point === null; i--) n++;
  return n;
}

export function createGoGame(black: GoPlayer, white: GoPlayer, size: GoSize, handicap: number): GoState {
  if (!SIZES.includes(size)) throw new GoError("Board size must be 9 or 13.");
  const h = Math.floor(handicap);
  if (h === 1 || h < 0 || h > MAX_HANDICAP[size]) {
    throw new GoError(`Handicap must be 0 or 2 to ${MAX_HANDICAP[size]} stones on ${size}x${size}.`);
  }
  let board = ".".repeat(size * size);
  for (const p of handicapPoints(size, h)) board = setAt(board, p, "b");
  return {
    v: 1, kind: "go", size, black, white,
    komi: h >= 2 ? HANDICAP_KOMI : KOMI, handicap: h,
    boards: [board], moves: [], prisoners: { b: 0, w: 0 },
    phase: "play", dead: [], accepted: [], takeback: null,
  };
}

function assertPlay(g: GoState, color: GoColor) {
  if (g.phase === "finished") throw new GoError("This game has finished.");
  if (g.phase === "scoring") throw new GoError("The game is being counted. Resume play to make a move.");
  if (turnOf(g) !== color) throw new GoError("It is not your move.");
}

export function playStone(g: GoState, color: GoColor, p: number, now = Date.now()): GoMove {
  assertPlay(g, color);
  const r = tryPlace(currentBoard(g), g.size, color, p);
  if ("error" in r) throw new GoError(r.error);
  if (g.boards.includes(r.board)) throw new GoError("Ko: that would repeat an earlier position. Play elsewhere first.");
  const move: GoMove = { color, point: p, captured: r.captured, at: now };
  g.moves.push(move);
  g.boards.push(r.board);
  g.prisoners[color] += r.captured;
  g.takeback = null;
  return move;
}

export function pass(g: GoState, color: GoColor, now = Date.now()): GoMove {
  assertPlay(g, color);
  const move: GoMove = { color, point: null, captured: 0, at: now };
  g.moves.push(move);
  g.boards.push(currentBoard(g));
  g.takeback = null;
  if (trailingPasses(g) >= 2) {
    g.phase = "scoring";
    g.dead = [];
    g.accepted = [];
  }
  return move;
}

export function resign(g: GoState, color: GoColor) {
  if (g.phase === "finished") throw new GoError("This game has finished.");
  g.phase = "finished";
  g.result = { winner: other(color), margin: null, reason: "resigned" };
  g.takeback = null;
}

// ------------------------------------------------------------------ takebacks

export function requestTakeback(g: GoState, color: GoColor) {
  if (g.phase !== "play") throw new GoError("Takebacks are only possible during play.");
  const last = g.moves[g.moves.length - 1];
  if (!last || last.color !== color) throw new GoError("You can only take back your move before your opponent replies.");
  g.takeback = color;
}

export function answerTakeback(g: GoState, color: GoColor, accept: boolean) {
  if (g.phase !== "play") throw new GoError("Takebacks are only possible during play.");
  if (g.takeback !== other(color)) throw new GoError("There is no takeback request to answer.");
  g.takeback = null;
  if (!accept) return;
  const m = g.moves.pop()!;
  g.boards.pop();
  g.prisoners[m.color] -= m.captured;
}

// ------------------------------------------------------------------ scoring

/** Toggles the whole group at p between alive and dead. Clears acceptances. */
export function toggleDead(g: GoState, p: number) {
  if (g.phase !== "scoring") throw new GoError("Dead stones are marked after both players pass.");
  const board = currentBoard(g);
  if (board[p] === "." || board[p] === undefined) throw new GoError("Tap a group of stones.");
  const { stones } = groupAt(board, g.size, p);
  const dead = new Set(g.dead);
  const makeDead = !dead.has(p);
  for (const s of stones) { if (makeDead) dead.add(s); else dead.delete(s); }
  g.dead = [...dead].sort((a, b) => a - b);
  g.accepted = [];
}

/** Area score: living stones plus empty regions surrounded by one colour. Dead stones count as empty. */
export function scoreGame(g: GoState): GoScore {
  const size = g.size;
  const dead = new Set(g.dead);
  const board = [...currentBoard(g)].map((ch, i) => (dead.has(i) ? "." : ch));
  let black = 0, white = 0;
  const blackTerritory: number[] = [];
  const whiteTerritory: number[] = [];
  const seen = new Set<number>();
  for (let p = 0; p < board.length; p++) {
    if (board[p] === "b") { black++; continue; }
    if (board[p] === "w") { white++; continue; }
    if (seen.has(p)) continue;
    const region: number[] = [];
    const borders = new Set<string>();
    const stack = [p];
    seen.add(p);
    while (stack.length) {
      const q = stack.pop()!;
      region.push(q);
      for (const n of neighbors(size, q)) {
        if (board[n] === ".") { if (!seen.has(n)) { seen.add(n); stack.push(n); } }
        else borders.add(board[n]);
      }
    }
    if (borders.size === 1) {
      if (borders.has("b")) { black += region.length; blackTerritory.push(...region); }
      else { white += region.length; whiteTerritory.push(...region); }
    }
  }
  return { black, white: white + g.komi, blackTerritory, whiteTerritory };
}

export function acceptScore(g: GoState, color: GoColor) {
  if (g.phase !== "scoring") throw new GoError("There is no score to accept yet.");
  if (!g.accepted.includes(color)) g.accepted.push(color);
  if (g.accepted.length === 2) {
    const s = scoreGame(g);
    const winner: GoColor = s.black > s.white ? "b" : "w";
    g.phase = "finished";
    g.result = { winner, margin: Math.abs(s.black - s.white), reason: "score", black: s.black, white: s.white };
  }
}

/** Leaves counting and continues the game; the player who resumes moves next. */
export function resumePlay(g: GoState, color: GoColor) {
  if (g.phase !== "scoring") throw new GoError("The game isn't being counted.");
  g.phase = "play";
  g.dead = [];
  g.accepted = [];
  // Whoever would move next after the two passes; if that's not the resumer, add a pass so they move.
  if (turnOf(g) !== color) {
    g.moves.push({ color: other(color), point: null, captured: 0, at: Date.now() });
    g.boards.push(currentBoard(g));
  }
}

// ------------------------------------------------------------------ view

export interface GoView extends GoState {
  id: string;
  version: number;
  myColor: GoColor | null;
  turn: GoColor;
}

export function goViewFor(g: GoState, playerId: string, id: string, version: number): GoView {
  return { ...g, id, version, myColor: colorOf(g, playerId), turn: turnOf(g) };
}

export function describeGoEnd(g: GoState): string {
  if (!g.result) return "";
  const w = playerOf(g, g.result.winner).name;
  if (g.result.reason === "resigned") return `${playerOf(g, other(g.result.winner)).name} resigned. ${w} wins.`;
  return `${w} wins by ${g.result.margin} points (Black ${g.result.black}, White ${g.result.white}).`;
}
