import { describe, expect, it } from "vitest";
import {
  answerDraw, answerTakeback, applyChessMove, ChessError, createChessGame, currentFen,
  offerDraw, requestTakeback, resign, turnOf, type ChessState,
} from "../src/shared/chess";

const A = { id: "a", name: "Aravind" };
const B = { id: "b", name: "Anitha" };

function play(g: ChessState, ...ucis: string[]) {
  for (const u of ucis) applyChessMove(g, turnOf(g), u);
}

describe("chess rules", () => {
  it("plays legal moves and rejects illegal ones", () => {
    const g = createChessGame(A, B);
    play(g, "e2e4");
    expect(g.moves[0].san).toBe("e4");
    expect(turnOf(g)).toBe("b");
    expect(() => applyChessMove(g, "w", "d2d4")).toThrow(/not your move/);
    expect(() => applyChessMove(g, "b", "e7e4")).toThrow(ChessError);
    expect(() => applyChessMove(g, "b", "garbage")).toThrow(ChessError);
  });

  it("detects checkmate (fool's mate)", () => {
    const g = createChessGame(A, B);
    play(g, "f2f3", "e7e5", "g2g4", "d8h4");
    expect(g.status).toBe("finished");
    expect(g.result).toBe("0-1");
    expect(g.reason).toBe("checkmate");
    expect(g.moves.at(-1)!.san).toBe("Qh4#");
    expect(() => applyChessMove(g, "w", "e2e4")).toThrow(/finished/);
  });

  it("handles castling, en passant and promotion", () => {
    const g = createChessGame(A, B);
    play(g, "e2e4", "a7a6", "e4e5", "d7d5", "e5d6"); // en passant
    expect(g.moves.at(-1)!.san).toBe("exd6");
    play(g, "a6a5", "g1f3", "a5a4", "f1e2", "a4a3", "e1g1"); // castle kingside
    expect(g.moves.at(-1)!.san).toBe("O-O");
    play(g, "a3b2", "d6c7", "b2a1n"); // underpromotion to knight
    expect(g.moves.at(-1)!.san).toBe("bxa1=N");
    expect(g.moves.at(-1)!.uci).toBe("b2a1n");
  });

  it("detects threefold repetition", () => {
    const g = createChessGame(A, B);
    play(g, "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8");
    expect(g.status).toBe("finished");
    expect(g.reason).toBe("threefold");
  });

  it("detects stalemate", () => {
    const t = createChessGame(A, B);
    t.fens = ["k7/8/8/1Q6/8/8/8/7K w - - 0 1"];
    play(t, "b5b6");
    expect(t.reason).toBe("stalemate");
    expect(t.result).toBe("1/2-1/2");
  });

  it("detects insufficient material", () => {
    const g = createChessGame(A, B);
    g.fens = ["k7/8/8/8/8/8/1r6/K7 w - - 0 1"];
    play(g, "a1b2");
    expect(g.reason).toBe("insufficient");
  });
});

describe("draws, resignation and takebacks", () => {
  it("offers, declines and accepts draws", () => {
    const g = createChessGame(A, B);
    play(g, "e2e4");
    offerDraw(g, "w");
    expect(g.drawOffer).toBe("w");
    answerDraw(g, "b", false);
    expect(g.drawOffer).toBeNull();
    offerDraw(g, "b");
    answerDraw(g, "w", true);
    expect(g.result).toBe("1/2-1/2");
    expect(g.reason).toBe("agreed");
  });

  it("a move declines the opponent's draw offer", () => {
    const g = createChessGame(A, B);
    play(g, "e2e4");
    offerDraw(g, "w");
    play(g, "e7e5");
    expect(g.drawOffer).toBeNull();
  });

  it("resigning gives the win to the opponent", () => {
    const g = createChessGame(A, B);
    resign(g, "w");
    expect(g.result).toBe("0-1");
  });

  it("takeback needs the opponent's agreement and only before they reply", () => {
    const g = createChessGame(A, B);
    play(g, "e2e4");
    expect(() => requestTakeback(g, "b")).toThrow();
    requestTakeback(g, "w");
    expect(g.takeback).toBe("w");
    answerTakeback(g, "b", true);
    expect(g.moves).toHaveLength(0);
    expect(currentFen(g)).toBe(g.fens[0]);
    play(g, "d2d4");
    requestTakeback(g, "w");
    answerTakeback(g, "b", false);
    expect(g.moves).toHaveLength(1);
  });

  it("takeback against the computer is immediate and undoes its reply", () => {
    const g = createChessGame(A, { cpu: 3, name: "Computer" });
    play(g, "e2e4", "e7e5");
    requestTakeback(g, "w");
    expect(g.moves).toHaveLength(0);
    expect(() => offerDraw(g, "w")).toThrow(/computer/);
  });
});
