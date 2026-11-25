import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Dictionary } from "../src/shared/dictionary";
import { fullBag, TILE_COUNTS } from "../src/shared/constants";
import {
  applyExchange, applyPass, applyPlay, applyResign, createGame, emptyBoard,
  evaluatePlacement, MoveError, type GameState, type PlacedTile,
} from "../src/shared/engine";

const dict = new Dictionary(readFileSync(new URL("../public/words-v1.txt", import.meta.url), "utf8"));
const isWord = (w: string) => dict.has(w);

/** Deterministic RNG for tests. */
function seeded(seed = 1) {
  let s = seed;
  return (n: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
}

const row = (r: number, c: number, word: string): PlacedTile[] =>
  [...word].map((l, i) => ({ r, c: c + i, l }));
const col = (r: number, c: number, word: string): PlacedTile[] =>
  [...word].map((l, i) => ({ r: r + i, c, l }));

/** Builds a 2-player game with chosen racks. */
function rigged(racks: string[][], bag: string[] = fullBag().slice(0, 40)): GameState {
  const g = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], seeded());
  g.seats = ["a", "b"];
  g.names = ["A", "B"];
  g.racks = racks.map((r) => [...r]);
  g.bag = [...bag];
  g.turn = 0;
  return g;
}

describe("dictionary", () => {
  it("accepts CSW and NWL words, including South Asian words", () => {
    for (const w of ["AA", "QI", "ZA", "ROTI", "DHAL", "PANEER", "GHEE", "CHAI", "ZZZS", "AAH"]) {
      expect(dict.has(w), w).toBe(true);
    }
  });
  it("is case-insensitive and rejects non-words", () => {
    expect(dict.has("roti")).toBe(true);
    for (const w of ["XQZ", "QWERTZ", "A", "", "ROTIX"]) expect(dict.has(w), w).toBe(false);
  });
  it("finds the first and last entries", () => {
    expect(dict.has("AA")).toBe(true);
    expect(dict.has("ZZZS")).toBe(true);
  });
});

describe("tile set", () => {
  it("has 100 tiles including 2 blanks", () => {
    expect(fullBag()).toHaveLength(100);
    expect(TILE_COUNTS["?"]).toBe(2);
  });
});

describe("placement and scoring", () => {
  it("scores the opening word on the double-word centre", () => {
    // HORN at row 7, cols 7..10: H4 O1 R1 N1 = 7, centre DW -> 14
    const res = evaluatePlacement(emptyBoard(), row(7, 7, "HORN"));
    expect(res.words.map((w) => w.word)).toEqual(["HORN"]);
    expect(res.score).toBe(14);
  });

  it("requires the first move to cover the centre", () => {
    expect(() => evaluatePlacement(emptyBoard(), row(0, 0, "HORN"))).toThrow(MoveError);
  });

  it("rejects a single tile on the first move", () => {
    expect(() => evaluatePlacement(emptyBoard(), [{ r: 7, c: 7, l: "A" }])).toThrow(/two letters/);
  });

  it("rejects diagonal and gapped placements", () => {
    expect(() => evaluatePlacement(emptyBoard(), [{ r: 7, c: 7, l: "A" }, { r: 8, c: 8, l: "A" }]))
      .toThrow(/single row or column/);
    expect(() => evaluatePlacement(emptyBoard(), [{ r: 7, c: 7, l: "A" }, { r: 7, c: 9, l: "A" }]))
      .toThrow(/gaps/);
  });

  it("rejects disconnected later moves", () => {
    const g = rigged([["H", "O", "R", "N", "A", "B", "C"], ["F", "A", "R", "M", "E", "E", "E"]]);
    applyPlay(g, 0, row(7, 7, "HORN"), { isWord });
    expect(() => applyPlay(g, 1, row(0, 0, "FARM"), { isWord })).toThrow(/connect/);
  });

  it("scores cross words and only applies premiums to new tiles", () => {
    const g = rigged([["H", "O", "R", "N", "X", "X", "X"], ["F", "A", "R", "M", "S", "E", "E"]]);
    applyPlay(g, 0, row(7, 7, "HORN"), { isWord }); // 14
    // FARM down col 8 ending on the O? No: play FARMS down column 11 from row 3,
    // with the S hooking HORN -> HORNS.
    const tiles = col(3, 11, "FARMS");
    const m = applyPlay(g, 1, tiles, { isWord });
    // FARMS: F(3,11)=4 on DW, A(4,11)=1, R(5,11)=1, M(6,11)=3, S(7,11)=1 on DL->2.
    //   (4+1+1+3+2)*2 = 22
    // HORNS: H4 O1 R1 N1 + S on DL 2 = 9 (no word multiplier; centre DW already used)
    expect(m.words).toEqual([{ w: "FARMS", s: 22 }, { w: "HORNS", s: 9 }]);
    expect(m.score).toBe(31);
  });

  it("scores blanks as zero but still lets them take word multipliers", () => {
    const tiles: PlacedTile[] = [
      { r: 7, c: 7, l: "Q" }, { r: 7, c: 8, l: "I", b: true },
    ];
    const res = evaluatePlacement(emptyBoard(), tiles);
    expect(res.score).toBe(20); // (10 + 0) * 2
  });

  it("adds a 50 point bingo for using all seven tiles", () => {
    const g = rigged([["R", "E", "T", "A", "I", "N", "S"], ["A", "A", "A", "A", "A", "A", "A"]]);
    const m = applyPlay(g, 0, row(7, 1, "RETAINS"), { isWord });
    // R(7,1) E(7,2) T(7,3)=DL A I N S(7,7)=DW: 1+1+2+1+1+1+1 = 8 *2 = 16 + 50
    expect(m.bingo).toBe(true);
    expect(m.score).toBe(66);
    expect(g.racks[0]).toHaveLength(7);
  });

  it("forms a word with a single tile in either direction", () => {
    const g = rigged([["H", "O", "R", "N", "X", "X", "X"], ["S", "E", "E", "E", "E", "E", "E"]]);
    applyPlay(g, 0, row(7, 7, "HORN"), { isWord });
    const m = applyPlay(g, 1, [{ r: 7, c: 11, l: "S" }], { isWord });
    expect(m.words).toEqual([{ w: "HORNS", s: 9 }]);
  });
});

describe("turns and game end", () => {
  it("rejects invalid words without using the turn", () => {
    const g = rigged([["X", "Q", "Z", "A", "B", "C", "D"], ["A", "A", "A", "A", "A", "A", "A"]]);
    expect(() => applyPlay(g, 0, row(7, 7, "XQZ"), { isWord })).toThrow(/Not a valid word: XQZ/);
    expect(g.turn).toBe(0);
    expect(g.moves).toHaveLength(0);
    expect(g.racks[0]).toEqual(["X", "Q", "Z", "A", "B", "C", "D"]);
  });

  it("rejects tiles the player does not hold, and moves out of turn", () => {
    const g = rigged([["A", "B", "C", "D", "E", "F", "G"], ["H", "O", "R", "N", "A", "A", "A"]]);
    expect(() => applyPlay(g, 0, row(7, 7, "HORN"), { isWord })).toThrow(/don't have/);
    expect(() => applyPlay(g, 1, row(7, 7, "HORN"), { isWord })).toThrow(/not your turn/);
  });

  it("only allows exchanges with at least 7 tiles in the bag", () => {
    const g = rigged([["A", "B", "C", "D", "E", "F", "G"], ["A", "A", "A", "A", "A", "A", "A"]], ["X", "Y"]);
    expect(() => applyExchange(g, 0, ["A"], seeded())).toThrow(/at least 7/);
    const g2 = rigged([["A", "B", "C", "D", "E", "F", "G"], ["A", "A", "A", "A", "A", "A", "A"]]);
    const before = g2.bag.length;
    applyExchange(g2, 0, ["A", "B"], seeded());
    expect(g2.bag.length).toBe(before);
    expect(g2.racks[0]).toHaveLength(7);
    expect(g2.turn).toBe(1);
  });

  it("ends after six consecutive scoreless turns and deducts rack values", () => {
    const g = rigged([["Q", "A", "A", "A", "A", "A", "A"], ["Z", "E", "E", "E", "E", "E", "E"]]);
    for (let i = 0; i < 6; i++) applyPass(g, g.turn);
    expect(g.status).toBe("finished");
    expect(g.end?.reason).toBe("scoreless");
    expect(g.scores).toEqual([-16, -16]);
  });

  it("awards the out player the others' rack values", () => {
    const g = rigged([["H", "O", "R", "N"], ["Q", "Z", "A"]], []);
    applyPlay(g, 0, row(7, 7, "HORN"), { isWord });
    expect(g.status).toBe("finished");
    expect(g.end?.reason).toBe("out");
    expect(g.scores).toEqual([14 + 21, -21]);
    expect(g.end?.winners).toEqual([0]);
  });

  it("skips resigned players and ends when one remains", () => {
    const g = createGame(
      [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], seeded(7),
    );
    const leaver = (g.turn + 1) % 3;
    applyResign(g, leaver);
    applyPass(g, g.turn);
    expect(g.turn).not.toBe(leaver);
    applyResign(g, g.turn);
    expect(g.status).toBe("finished");
    expect(g.end?.reason).toBe("resigned");
  });

  it("deals 7 tiles to each of 4 players from a 100-tile bag", () => {
    const g = createGame(
      ["a", "b", "c", "d"].map((id) => ({ id, name: id })), seeded(3),
    );
    expect(g.racks.every((r) => r.length === 7)).toBe(true);
    expect(g.bag).toHaveLength(72);
  });
});
