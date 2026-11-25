import { describe, expect, it } from "vitest";
import {
  cpuSalvo, createSeaGame, fire, FLEETS, placeFleet, randomFleet, resign, seaViewFor, shipCells,
  shooterOf, shotsAllowed, specOf, sunkShips, validateFleet, type SeaState, type Ship,
} from "../src/shared/seabattle";

/** mulberry32: small PRNG with good low bits (the server uses crypto randomness). */
function seeded(seed = 1) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };
}

const A = { id: "a", name: "Aravind" };
const K = { id: "k", name: "Kavya" };

// All ships horizontal on their own rows, starting at column 0.
const rowFleet = (size: 8 | 10): Ship[] => FLEETS[size].map((s, i) => ({ key: s.key, r: i * 2, c: 0, dir: "h" }));
const cellsOf = (g: SeaState, seat: 0 | 1) =>
  g.fleets[seat]!.flatMap((s) => shipCells(g.size, s, specOf(g.size, s.key).len));

function newGame(size: 8 | 10 = 10, first: 0 | 1 = 0) {
  const g = createSeaGame(A, K, size, seeded());
  g.first = first;
  placeFleet(g, 0, rowFleet(size));
  placeFleet(g, 1, rowFleet(size));
  return g;
}

/** Fires the next `n` unfired squares from `pool` (or anywhere free). */
function salvo(g: SeaState, pool: number[]) {
  const seat = shooterOf(g);
  const fired = new Set(g.salvos.filter((s) => s.by === seat).flatMap((s) => s.shots.map((x) => x.p)));
  const n = shotsAllowed(g);
  const all = [...pool, ...Array.from({ length: g.size * g.size }, (_, i) => i)];
  const pts: number[] = [];
  for (const p of all) { if (!fired.has(p) && !pts.includes(p)) pts.push(p); if (pts.length === n) break; }
  return fire(g, seat, pts);
}

describe("fleet placement", () => {
  it("validates fleets and accepts touching ships", () => {
    validateFleet(10, rowFleet(10));
    const touching = FLEETS[10].map((s, i) => ({ key: s.key, r: i, c: 0, dir: "h" as const }));
    validateFleet(10, touching);
    const overlap = rowFleet(10); overlap[1] = { ...overlap[1], r: 0 };
    expect(() => validateFleet(10, overlap)).toThrow(/overlap/);
    const off = rowFleet(10); off[0] = { ...off[0], c: 7 };
    expect(() => validateFleet(10, off)).toThrow(/fit/);
    expect(() => validateFleet(10, rowFleet(10).slice(1))).toThrow();
  });

  it("random fleets are always valid", () => {
    const rng = seeded(42);
    for (let i = 0; i < 200; i++) {
      validateFleet(10, randomFleet(10, rng));
      validateFleet(8, randomFleet(8, rng));
    }
  });

  it("battle starts only when both fleets are placed; computer places at once", () => {
    const g = createSeaGame(A, K, 10, seeded());
    expect(() => fire(g, 0, [0])).toThrow(/both fleets/);
    placeFleet(g, 0, rowFleet(10));
    expect(g.phase).toBe("setup");
    placeFleet(g, 1, rowFleet(10));
    expect(g.phase).toBe("battle");
    const c = createSeaGame(A, { cpu: "easy", name: "Computer" }, 8, seeded());
    expect(c.fleets[1]).not.toBeNull();
  });
});

describe("salvo rule", () => {
  it("fires one shot per ship afloat, records hits and announces sinks", () => {
    const g = newGame(10, 0);
    expect(shotsAllowed(g)).toBe(5);
    expect(() => fire(g, 1, [0, 1, 2, 3, 4])).toThrow(/not your turn/);
    expect(() => fire(g, 0, [0, 1])).toThrow(/exactly 5/);
    expect(() => fire(g, 0, [0, 0, 1, 2, 3])).toThrow(/different/);
    // Destroyer is on row 8, columns 0-1 (cells 80, 81).
    const s = fire(g, 0, [80, 81, 99, 98, 97]);
    expect(s.shots.filter((x) => x.hit)).toHaveLength(2);
    expect(s.shots.find((x) => x.p === 81)!.sunk).toBe("destroyer");
    expect(sunkShips(g, 1).has("destroyer")).toBe(true);
    // Kavya fires; then Aravind has... still 5; Kavya's target count is unaffected.
    salvo(g, [99]);
    expect(shooterOf(g)).toBe(0);
    expect(() => fire(g, 0, [80, 1, 2, 3, 4])).toThrow(/already fired/);
  });

  it("losing ships reduces your shots", () => {
    const g = newGame(10, 1);
    fire(g, 1, [80, 81, 60, 61, 62]); // Kavya sinks Aravind's destroyer and submarine
    expect(shotsAllowed(g)).toBe(3);
  });

  /** Both fleets down to the last square of their destroyer; Aravind (first) to fire. */
  function endgame() {
    const g = newGame(8, 0);
    const lastA = 49, lastK = 49; // destroyer is on row 6 at cells 48-49
    const hitsOn = (seat: 0 | 1, except: number) =>
      cellsOf(g, seat).filter((p) => p !== except).map((p) => ({ p, hit: true }));
    g.salvos.push({ by: 0, shots: hitsOn(1, lastK), at: 0 }, { by: 1, shots: hitsOn(0, lastA), at: 0 });
    return g;
  }

  it("second player gets a final salvo and wins nothing if they miss", () => {
    const g = endgame();
    expect(shotsAllowed(g)).toBe(1);
    fire(g, 0, [49]);
    expect(g.lastChance).toBe(true);
    expect(g.phase).toBe("battle");
    expect(shooterOf(g)).toBe(1);
    fire(g, 1, [63]);
    expect(g.result).toEqual({ winner: 0, reason: "sunk" });
  });

  it("final salvo that also sinks everything is a draw", () => {
    const g = endgame();
    fire(g, 0, [49]);
    fire(g, 1, [49]);
    expect(g.result).toEqual({ winner: null, reason: "sunk" });
  });

  it("second player wins outright when they sink the fleet first", () => {
    const g = newGame(8, 0);
    const a = cellsOf(g, 0);
    while (g.phase === "battle") {
      salvo(g, [63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50]);
      if (g.phase !== "battle") break;
      salvo(g, a);
    }
    expect(g.result).toEqual({ winner: 1, reason: "sunk" });
  });

  it("resigning ends the game", () => {
    const g = newGame();
    resign(g, 0);
    expect(g.result).toEqual({ winner: 1, reason: "resigned" });
  });
});

describe("hidden information", () => {
  it("never reveals unsunk enemy ships until the game ends", () => {
    const g = newGame(10, 0);
    fire(g, 0, [80, 81, 99, 98, 97]);
    const v = seaViewFor(g, "a", "x", 1);
    expect(v.theirShips.map((s) => s.key)).toEqual(["destroyer"]);
    expect(JSON.stringify(v)).not.toContain('"fleets"');
    resign(g, 1);
    expect(seaViewFor(g, "a", "x", 2).theirShips).toHaveLength(5);
  });
});

describe("computer", () => {
  for (const level of ["easy", "smart"] as const) {
    it(`${level} computer fires legal salvos and eventually wins`, () => {
      const rng = seeded(9);
      const g = createSeaGame(A, { cpu: level, name: "Computer" }, 10, rng);
      g.first = 1;
      placeFleet(g, 0, randomFleet(10, rng));
      let turns = 0;
      while (g.phase === "battle" && turns < 200) {
        if (shooterOf(g) === 1) fire(g, 1, cpuSalvo(g, 1, level, rng));
        else salvo(g, [99]); // the human keeps firing at the bottom-right first
        turns++;
      }
      expect(g.phase).toBe("finished");
    });
  }

  it("smart computer finishes off a hit ship", () => {
    const rng = seeded(3);
    const g = createSeaGame(A, { cpu: "smart", name: "Computer" }, 10, rng);
    g.first = 1;
    placeFleet(g, 0, rowFleet(10)); // carrier on row 0, cols 0-4
    g.salvos.push({ by: 1, shots: [{ p: 2, hit: true }], at: 0 }, { by: 0, shots: [{ p: 99, hit: false }], at: 0 });
    const shots = cpuSalvo(g, 1, "smart", rng);
    expect(shots.some((p) => [1, 3, 12].includes(p))).toBe(true);
  });
});
