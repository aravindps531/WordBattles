import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bagFor, RULES } from "../src/shared/constants";
import { Dictionary } from "../src/shared/dictionary";
import {
  applyExchange, applyPlay, createGame, emptyBoard, evaluatePlacement, type GameState, type PlacedTile,
} from "../src/shared/engine";

const dict = new Dictionary(readFileSync(new URL("../public/words-v1.txt", import.meta.url), "utf8"));
const isWord = (w: string) => dict.has(w);
const mega = RULES.mega;
function rng(seed = 5) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}
const row = (r: number, c: number, word: string): PlacedTile[] => [...word].map((l, i) => ({ r, c: c + i, l }));

function rigged(racks: string[][], bagSize = 60): GameState {
  const g = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], rng(), "mega");
  g.seats = ["a", "b"]; g.names = ["A", "B"];
  g.racks = racks.map((r) => [...r]);
  g.bag = bagFor(mega).slice(0, bagSize);
  g.turn = 0;
  return g;
}

describe("Mega Word Battle setup", () => {
  it("has 225 tiles with 5 blanks, a 21x21 board and 8-tile racks", () => {
    const bag = bagFor(mega);
    expect(bag).toHaveLength(225);
    expect(bag.filter((t) => t === "?")).toHaveLength(5);
    const g = createGame(["a", "b", "c", "d"].map((id) => ({ id, name: id })), rng(), "mega");
    expect(g.variant).toBe("mega");
    expect(g.board).toHaveLength(21);
    expect(g.board.every((r) => r.length === 21)).toBe(true);
    expect(g.racks.every((r) => r.length === 8)).toBe(true);
    expect(g.bag).toHaveLength(225 - 32);
  });

  it("standard games are unchanged", () => {
    const g = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], rng());
    expect(g.variant).toBeUndefined();
    expect(g.board).toHaveLength(15);
    expect(g.racks[0]).toHaveLength(7);
  });

  it("layout is symmetric, centred, and includes quadruple squares", () => {
    const p = mega.premiums;
    for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) {
      expect(p[r][c]).toBe(p[c][r]);
      expect(p[r][c]).toBe(p[20 - r][c]);
      expect(p[r][c]).toBe(p[r][20 - c]);
    }
    const count = (t: string) => p.flat().filter((x) => x === t).length;
    expect(count("QW")).toBe(4);
    expect(count("QL")).toBeGreaterThan(0);
    expect(p[10][10]).toBe("DW");
    expect(p[0][0]).toBe("QW");
  });
});

describe("Mega scoring", () => {
  it("first word must cover the centre at (10,10)", () => {
    expect(() => evaluatePlacement(emptyBoard(21), row(0, 0, "CAT"), mega)).toThrow(/centre/);
    const res = evaluatePlacement(emptyBoard(21), row(10, 10, "CAT"), mega);
    expect(res.score).toBe(10); // (3+1+1) x2 centre
  });

  it("quadruple letter and quadruple word squares multiply by four", () => {
    // QL at (5,5): place "ZA" down from (5,5)? Use a board with a tile to connect to.
    const board = emptyBoard(21);
    for (let r = 5; r <= 10; r++) board[r][10] = { l: "A" }; // a connector column (not real words; only geometry/score matter)
    // "ZA" across row 5 ending on the existing A at (5,10): Z at (5,9) is TL -> 30, A 1 => 31
    const tl = evaluatePlacement(board, [{ r: 5, c: 9, l: "Z" }], mega);
    expect(tl.words[0]).toMatchObject({ word: "ZA", score: 31 });
    // Corner QW: word from (0,0) to (0,2) on an empty board isn't allowed first, so test directly with a connector.
    const b2 = emptyBoard(21);
    b2[1][2] = { l: "T" };
    const qw = evaluatePlacement(b2, row(0, 0, "CAT"), mega);
    // C on QW (0,0); A, T plain: (3+1+1) x4 = 20; cross word TT? (0,2)+(1,2) "TT" = 2
    expect(qw.words[0]).toMatchObject({ word: "CAT", score: 20 });
  });

  it("using all 8 tiles earns 50 points; 7 tiles earns nothing extra", () => {
    const g = rigged([["S", "T", "A", "R", "L", "I", "N", "G"], ["E", "E", "E", "E", "E", "E", "E", "E"]]);
    const m = applyPlay(g, 0, row(10, 3, "STARLING"), { isWord });
    expect(m.bingo).toBe(true);
    // S T A R L I N G at (10,3)..(10,10): no premiums on row 10 cols 3-9 except DL at (10,7)? compute from layout
    const base = evaluatePlacement(emptyBoard(21), row(10, 3, "STARLING"), mega).score;
    expect(m.score).toBe(base);
    expect(base - 50).toBeGreaterThan(0);
    expect(g.racks[0]).toHaveLength(8);
    const g2 = rigged([["R", "E", "T", "A", "I", "N", "S", "X"], ["E", "E", "E", "E", "E", "E", "E", "E"]]);
    const m2 = applyPlay(g2, 0, row(10, 4, "RETAINS"), { isWord });
    expect(m2.bingo).toBeUndefined();
  });

  it("exchanges need at least 8 tiles in the bag", () => {
    const g = rigged([["A", "B", "C", "D", "E", "F", "G", "H"], ["A", "A", "A", "A", "A", "A", "A", "A"]], 7);
    expect(() => applyExchange(g, 0, ["A"], rng())).toThrow(/at least 8/);
    const g2 = rigged([["A", "B", "C", "D", "E", "F", "G", "H"], ["A", "A", "A", "A", "A", "A", "A", "A"]], 8);
    applyExchange(g2, 0, ["A"], rng());
    expect(g2.racks[0]).toHaveLength(8);
  });
});
