import { Chess } from "chess.js";

/** A seat in a chess game: a family member or the computer. */
export type Side =
  | { id: string; name: string }
  | { cpu: number; name: string }; // cpu = strength level 1..8

export type Color = "w" | "b";
export type ChessResult = "1-0" | "0-1" | "1/2-1/2";
export type ChessEndReason =
  | "checkmate" | "stalemate" | "threefold" | "fifty-move" | "insufficient" | "resigned" | "agreed";

export interface ChessMove { san: string; uci: string; at: number }

export interface ChessState {
  v: 1;
  kind: "chess";
  white: Side;
  black: Side;
  /** fens[0] is the start position; fens[i] is the position after moves[i-1]. */
  fens: string[];
  moves: ChessMove[];
  status: "active" | "finished";
  result?: ChessResult;
  reason?: ChessEndReason;
  drawOffer?: Color | null;
  takeback?: Color | null;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const CPU_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export class ChessError extends Error {}

export const isCpu = (s: Side): s is { cpu: number; name: string } => "cpu" in s;
export const sideId = (s: Side) => (isCpu(s) ? null : s.id);
export const other = (c: Color): Color => (c === "w" ? "b" : "w");

export function currentFen(g: ChessState): string {
  return g.fens[g.fens.length - 1];
}

export function turnOf(g: ChessState): Color {
  return currentFen(g).split(" ")[1] as Color;
}

export function sideOf(g: ChessState, c: Color): Side {
  return c === "w" ? g.white : g.black;
}

/** The colour a player controls in this game, or null if not playing. */
export function colorOf(g: ChessState, playerId: string): Color | null {
  if (sideId(g.white) === playerId) return "w";
  if (sideId(g.black) === playerId) return "b";
  return null;
}

/** Position identity for repetition: placement, side to move, castling, en passant. */
function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function createChessGame(white: Side, black: Side): ChessState {
  return { v: 1, kind: "chess", white, black, fens: [START_FEN], moves: [], status: "active", drawOffer: null, takeback: null };
}

function finish(g: ChessState, result: ChessResult, reason: ChessEndReason) {
  g.status = "finished";
  g.result = result;
  g.reason = reason;
  g.drawOffer = null;
  g.takeback = null;
}

/** Plays a move given in UCI form (e.g. "e2e4", "e7e8q"). Throws ChessError if illegal. */
export function applyChessMove(g: ChessState, color: Color, uci: string, now = Date.now()): ChessMove {
  if (g.status !== "active") throw new ChessError("This game has finished.");
  if (turnOf(g) !== color) throw new ChessError("It is not your move.");
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(uci));
  if (!m) throw new ChessError("Invalid move.");
  const chess = new Chess(currentFen(g));
  let made;
  try {
    made = chess.move({ from: m[1], to: m[2], promotion: m[3] ?? "q" });
  } catch {
    throw new ChessError("That move is not allowed.");
  }
  const fen = chess.fen();
  const move: ChessMove = { san: made.san, uci: made.from + made.to + (made.promotion ?? ""), at: now };
  g.moves.push(move);
  g.fens.push(fen);
  // A move declines any pending draw offer from the opponent and cancels takeback requests.
  if (g.drawOffer && g.drawOffer !== color) g.drawOffer = null;
  g.takeback = null;

  if (chess.isCheckmate()) finish(g, color === "w" ? "1-0" : "0-1", "checkmate");
  else if (chess.isStalemate()) finish(g, "1/2-1/2", "stalemate");
  else if (chess.isInsufficientMaterial()) finish(g, "1/2-1/2", "insufficient");
  else if (chess.isDrawByFiftyMoves()) finish(g, "1/2-1/2", "fifty-move");
  else {
    const key = positionKey(fen);
    if (g.fens.filter((f) => positionKey(f) === key).length >= 3) finish(g, "1/2-1/2", "threefold");
  }
  return move;
}

export function resign(g: ChessState, color: Color) {
  if (g.status !== "active") throw new ChessError("This game has finished.");
  finish(g, color === "w" ? "0-1" : "1-0", "resigned");
}

export function offerDraw(g: ChessState, color: Color) {
  if (g.status !== "active") throw new ChessError("This game has finished.");
  if (isCpu(sideOf(g, other(color)))) throw new ChessError("The computer doesn't accept draws.");
  if (g.drawOffer === other(color)) { finish(g, "1/2-1/2", "agreed"); return; }
  g.drawOffer = color;
}

export function answerDraw(g: ChessState, color: Color, accept: boolean) {
  if (g.status !== "active") throw new ChessError("This game has finished.");
  if (g.drawOffer !== other(color)) throw new ChessError("There is no draw offer to answer.");
  if (accept) finish(g, "1/2-1/2", "agreed");
  else g.drawOffer = null;
}

function undoPlies(g: ChessState, n: number) {
  for (let i = 0; i < n && g.moves.length; i++) { g.moves.pop(); g.fens.pop(); }
  g.drawOffer = null;
  g.takeback = null;
}

/**
 * Asks to take back your last move. Against the computer this happens at once
 * (undoing the computer's reply too). Against a person, they must agree, and
 * only while they haven't replied yet.
 */
export function requestTakeback(g: ChessState, color: Color) {
  if (g.status !== "active") throw new ChessError("This game has finished.");
  const lastMover = g.moves.length ? (g.moves.length % 2 === 1 ? "w" : "b") : null;
  if (isCpu(sideOf(g, other(color)))) {
    if (!lastMover) throw new ChessError("There is nothing to take back.");
    const n = lastMover === color ? 1 : 2;
    if (g.moves.length < n) throw new ChessError("There is nothing to take back.");
    undoPlies(g, n);
    return;
  }
  if (lastMover !== color) throw new ChessError("You can only take back your move before your opponent replies.");
  g.takeback = color;
}

export function answerTakeback(g: ChessState, color: Color, accept: boolean) {
  if (g.status !== "active") throw new ChessError("This game has finished.");
  if (g.takeback !== other(color)) throw new ChessError("There is no takeback request to answer.");
  if (accept) undoPlies(g, 1);
  else g.takeback = null;
}

export interface ChessView extends ChessState {
  id: string;
  version: number;
  myColor: Color | null;
  turn: Color;
}

export function chessViewFor(g: ChessState, playerId: string, id: string, version: number): ChessView {
  return { ...g, id, version, myColor: colorOf(g, playerId), turn: turnOf(g) };
}

export function describeChessEnd(g: ChessState): string {
  const w = g.white.name, b = g.black.name;
  switch (g.reason) {
    case "checkmate": return `Checkmate. ${g.result === "1-0" ? w : b} wins.`;
    case "resigned": return `${g.result === "1-0" ? b : w} resigned. ${g.result === "1-0" ? w : b} wins.`;
    case "stalemate": return "Draw by stalemate.";
    case "threefold": return "Draw: the same position happened three times.";
    case "fifty-move": return "Draw by the 50-move rule.";
    case "insufficient": return "Draw: not enough pieces left to checkmate.";
    case "agreed": return "Draw agreed.";
    default: return "";
  }
}
