import { describe, expect, it } from "vitest";
import {
  acceptScore, answerTakeback, createGoGame, currentBoard, handicapPoints, pass, playStone,
  pointName, requestTakeback, resign, resumePlay, scoreGame, toggleDead, turnOf, type GoState,
} from "../src/shared/go";

const A = { id: "a", name: "Aravind" };
const B = { id: "b", name: "Anitha" };

/** Point from Go coordinates, e.g. "C3" on a 9x9 board. */
function pt(size: number, name: string): number {
  const col = "ABCDEFGHJKLMNOPQRST".indexOf(name[0]);
  const row = size - Number(name.slice(1));
  return row * size + col;
}

/** Plays a sequence like "D5 E5 pass ..." alternating colours from whoever is to move. */
function play(g: GoState, seq: string) {
  for (const m of seq.trim().split(/\s+/)) {
    if (m === "pass") pass(g, turnOf(g));
    else playStone(g, turnOf(g), pt(g.size, m));
  }
}

/** Sets up a 9x9 position from a diagram (rows top to bottom). */
function fromDiagram(rows: string[], toMove: "b" | "w" = "b"): GoState {
  const g = createGoGame(A, B, 9, 0);
  g.boards = [rows.join("").replace(/\s/g, "")];
  if (toMove === "w") g.moves.push({ color: "b", point: null, captured: 0, at: 0 }), g.boards.push(g.boards[0]);
  return g;
}

describe("go basics", () => {
  it("names points with Go coordinates (no I)", () => {
    expect(pointName(9, 0)).toBe("A9");
    expect(pointName(9, 80)).toBe("J1");
    expect(pointName(13, pt(13, "K10"))).toBe("K10");
  });

  it("alternates turns starting with Black and rejects occupied points", () => {
    const g = createGoGame(A, B, 9, 0);
    play(g, "E5");
    expect(turnOf(g)).toBe("w");
    expect(() => playStone(g, "b", pt(9, "D4"))).toThrow(/not your move/);
    expect(() => playStone(g, "w", pt(9, "E5"))).toThrow(/taken/);
  });

  it("captures a single stone and counts prisoners", () => {
    const g = createGoGame(A, B, 9, 0);
    play(g, "E5 E6 D6 pass F6 pass E7");
    expect(currentBoard(g)[pt(9, "E6")]).toBe(".");
    expect(g.prisoners.b).toBe(1);
    expect(g.moves.at(-1)!.captured).toBe(1);
  });

  it("captures a group on the edge", () => {
    const g = fromDiagram([
      "ww.......",
      "bb.......",
      ".........", ".........", ".........", ".........", ".........", ".........", ".........",
    ]);
    play(g, "C9");
    expect(currentBoard(g).slice(0, 2)).toBe("..");
    expect(g.prisoners.b).toBe(2);
  });

  it("forbids suicide but allows a move that captures", () => {
    const g = fromDiagram([
      ".b.......",
      "b........",
      ".........", ".........", ".........", ".........", ".........", ".........", ".........",
    ], "w");
    expect(() => playStone(g, "w", pt(9, "A9"))).toThrow(/no liberties/);
    const h = fromDiagram([
      ".bw......",
      "bw.......",
      "w........",
      ".........", ".........", ".........", ".........", ".........", ".........",
    ], "w");
    playStone(h, "w", pt(9, "A9")); // captures both black stones, so not suicide
    expect(h.prisoners.w).toBe(2);
  });

  it("enforces ko: no immediate recapture, allowed after playing elsewhere", () => {
    const g = fromDiagram([
      ".bw......",
      "b.bw.....",
      ".bw......",
      ".........", ".........", ".........", ".........", ".........", ".........",
    ], "w");
    playStone(g, "w", pt(9, "B8")); // white captures at C8
    expect(g.prisoners.w).toBe(1);
    expect(() => playStone(g, "b", pt(9, "C8"))).toThrow(/Ko/);
    play(g, "H2 H3"); // ko threat and answer
    playStone(g, "b", pt(9, "C8")); // now legal
    expect(g.prisoners.b).toBe(1);
  });
});

describe("handicap", () => {
  it("places stones on star points, gives White the first move and 0.5 komi", () => {
    const g = createGoGame(A, B, 9, 4);
    expect(handicapPoints(9, 4).map((p) => pointName(9, p)).sort()).toEqual(["C3", "C7", "G3", "G7"]);
    expect([...currentBoard(g)].filter((c) => c === "b")).toHaveLength(4);
    expect(turnOf(g)).toBe("w");
    expect(g.komi).toBe(0.5);
    expect(() => createGoGame(A, B, 9, 6)).toThrow();
    expect(() => createGoGame(A, B, 9, 1)).toThrow();
    expect(createGoGame(A, B, 13, 9).boards[0].split("b").length - 1).toBe(9);
  });
});

describe("end of game", () => {
  it("two passes start counting; area scoring with komi", () => {
    // Black owns the left 4 columns, White the right 4, a wall each on columns D and E... simple split.
    const g = fromDiagram([
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
    ]);
    play(g, "pass pass");
    expect(g.phase).toBe("scoring");
    const s = scoreGame(g);
    expect(s.black).toBe(36);           // 9 stones + 27 territory
    expect(s.white).toBe(45 + 7.5);     // 9 stones + 36 territory + komi
    acceptScore(g, "b");
    expect(g.phase).toBe("scoring");
    acceptScore(g, "w");
    expect(g.phase).toBe("finished");
    expect(g.result).toMatchObject({ winner: "w", margin: 16.5, reason: "score" });
  });

  it("dead stones count for the surrounding player; marking clears acceptance", () => {
    const g = fromDiagram([
      "...bw....",
      ".w.bw....",   // a lone white stone inside Black's area
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
      "...bw....",
    ]);
    play(g, "pass pass");
    expect(scoreGame(g).black).toBe(9); // region touches white, so it isn't Black's
    acceptScore(g, "w");
    toggleDead(g, pt(9, "B8"));
    expect(g.accepted).toEqual([]);
    expect(scoreGame(g).black).toBe(36);
    toggleDead(g, pt(9, "B8"));
    expect(g.dead).toEqual([]);
  });

  it("resuming play lets the resumer move and passes are needed again", () => {
    const g = createGoGame(A, B, 9, 0);
    play(g, "E5 pass pass");
    expect(g.phase).toBe("scoring");
    resumePlay(g, "b");
    expect(g.phase).toBe("play");
    expect(turnOf(g)).toBe("b");
    play(g, "D4");
    expect(g.phase).toBe("play");
  });

  it("resignation ends the game", () => {
    const g = createGoGame(A, B, 13, 0);
    resign(g, "w");
    expect(g.result).toMatchObject({ winner: "b", reason: "resigned" });
    expect(() => playStone(g, "b", 0)).toThrow(/finished/);
  });

  it("takeback restores the board and prisoners when the opponent agrees", () => {
    const g = createGoGame(A, B, 9, 0);
    play(g, "E5 E6 D6 pass F6 pass E7");
    requestTakeback(g, "b");
    answerTakeback(g, "w", true);
    expect(currentBoard(g)[pt(9, "E6")]).toBe("w");
    expect(g.prisoners.b).toBe(0);
    expect(turnOf(g)).toBe("b");
    expect(() => requestTakeback(g, "b")).toThrow();
  });
});
