// Standard English tile set (100 tiles) and 15x15 premium-square layout.

export const BOARD_SIZE = 15;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
export const BLANK = "?";
/** Game ends after this many consecutive scoreless turns (passes, exchanges). */
export const SCORELESS_TURN_LIMIT = 6;

export const TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
  [BLANK]: 2,
};

export const TILE_POINTS: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  [BLANK]: 0,
};

export type Premium = "TW" | "DW" | "TL" | "DL" | null;

const TW: [number, number][] = [
  [0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14],
];
const DW: [number, number][] = [
  [1, 1], [2, 2], [3, 3], [4, 4], [1, 13], [2, 12], [3, 11], [4, 10],
  [13, 1], [12, 2], [11, 3], [10, 4], [13, 13], [12, 12], [11, 11], [10, 10],
  [7, 7],
];
const TL: [number, number][] = [
  [1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9],
  [9, 13], [13, 5], [13, 9],
];
const DL: [number, number][] = [
  [0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6],
  [6, 8], [6, 12], [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0],
  [11, 7], [11, 14], [12, 6], [12, 8], [14, 3], [14, 11],
];

export const PREMIUMS: Premium[][] = (() => {
  const grid: Premium[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array<Premium>(BOARD_SIZE).fill(null),
  );
  for (const [r, c] of TW) grid[r][c] = "TW";
  for (const [r, c] of DW) grid[r][c] = "DW";
  for (const [r, c] of TL) grid[r][c] = "TL";
  for (const [r, c] of DL) grid[r][c] = "DL";
  return grid;
})();

export const CENTER = 7;

export function fullBag(): string[] {
  const bag: string[] = [];
  for (const [letter, n] of Object.entries(TILE_COUNTS)) {
    for (let i = 0; i < n; i++) bag.push(letter);
  }
  return bag;
}

// ------------------------------------------------------------------ variants

export type Variant = "standard" | "mega";
export type AnyPremium = Premium | "QW" | "QL";

export interface Rules {
  variant: Variant;
  name: string;
  size: number;
  center: number;
  rackSize: number;
  bingoBonus: number;
  premiums: AnyPremium[][];
  tileCounts: Record<string, number>;
}

/**
 * Mega Word Battle: 21x21, 225 tiles (5 blanks), 8-tile rack, 50 points for using all 8.
 * Letter frequencies are the standard set scaled up; point values are unchanged.
 */
export const MEGA_TILE_COUNTS: Record<string, number> = {
  A: 21, B: 5, C: 5, D: 9, E: 28, F: 4, G: 6, H: 5, I: 20, J: 2, K: 2, L: 9, M: 5,
  N: 13, O: 18, P: 5, Q: 2, R: 14, S: 9, T: 14, U: 9, V: 3, W: 4, X: 2, Y: 4, Z: 2,
  [BLANK]: 5,
};

/** Our own 21x21 layout, defined for one eighth of the board and mirrored. */
const MEGA_OCTANT: [number, number, AnyPremium][] = [
  [0, 0, "QW"], [0, 3, "DL"], [0, 7, "TW"], [0, 10, "DL"],
  [1, 1, "DW"], [1, 5, "TL"], [1, 9, "QL"],
  [2, 2, "DW"], [2, 6, "DL"],
  [3, 3, "DW"], [3, 8, "DL"],
  [4, 4, "DW"], [4, 10, "TW"],
  [5, 5, "QL"], [5, 9, "TL"],
  [6, 6, "DW"],
  [7, 7, "TL"], [7, 10, "DL"],
  [8, 8, "DL"],
  [9, 9, "DL"],
  [10, 10, "DW"],
];

function mirror(size: number, octant: [number, number, AnyPremium][]): AnyPremium[][] {
  const g: AnyPremium[][] = Array.from({ length: size }, () => Array<AnyPremium>(size).fill(null));
  const m = size - 1;
  for (const [r, c, t] of octant) {
    for (const [a, b] of [[r, c], [c, r]]) {
      for (const [x, y] of [[a, b], [a, m - b], [m - a, b], [m - a, m - b]]) g[x][y] = t;
    }
  }
  return g;
}

export const RULES: Record<Variant, Rules> = {
  standard: {
    variant: "standard", name: "Word Battle", size: BOARD_SIZE, center: CENTER, rackSize: RACK_SIZE,
    bingoBonus: BINGO_BONUS, premiums: PREMIUMS, tileCounts: TILE_COUNTS,
  },
  mega: {
    variant: "mega", name: "Mega Word Battle", size: 21, center: 10, rackSize: 8,
    bingoBonus: 50, premiums: mirror(21, MEGA_OCTANT), tileCounts: MEGA_TILE_COUNTS,
  },
};

export function rulesFor(variant?: Variant): Rules {
  return RULES[variant ?? "standard"] ?? RULES.standard;
}

export function bagFor(rules: Rules): string[] {
  const bag: string[] = [];
  for (const [letter, n] of Object.entries(rules.tileCounts)) for (let i = 0; i < n; i++) bag.push(letter);
  return bag;
}
