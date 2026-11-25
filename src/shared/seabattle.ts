/**
 * Sea Battle (the classic pencil-and-paper naval game) with the Salvo rule:
 * each turn you fire one shot per ship you still have afloat.
 * "Equal turns": if the first player sinks the whole fleet, the second player
 * gets one last salvo; if that also sinks everything, the game is a draw.
 */

export type SeaSize = 8 | 10;
export type Dir = "h" | "v";
export type SeaCpu = "easy" | "smart";
export type SeaSide = { id: string; name: string } | { cpu: SeaCpu; name: string };

export interface ShipSpec { key: string; name: string; len: number }
export interface Ship { key: string; r: number; c: number; dir: Dir }
export interface ShotResult { p: number; hit: boolean; sunk?: string }
export interface Salvo { by: 0 | 1; shots: ShotResult[]; at: number }

export interface SeaState {
  v: 1;
  kind: "sea";
  size: SeaSize;
  players: [SeaSide, SeaSide];
  fleets: [Ship[] | null, Ship[] | null];
  first: 0 | 1;
  salvos: Salvo[];
  phase: "setup" | "battle" | "finished";
  lastChance: boolean;            // second player's final salvo after the first player sank everything
  finalShots?: number;            // ships the second player had afloat before their fleet was sunk
  result?: { winner: 0 | 1 | null; reason: "sunk" | "resigned" };
}

export class SeaError extends Error {}

export const FLEETS: Record<SeaSize, ShipSpec[]> = {
  10: [
    { key: "carrier", name: "Carrier", len: 5 },
    { key: "battleship", name: "Battleship", len: 4 },
    { key: "cruiser", name: "Cruiser", len: 3 },
    { key: "submarine", name: "Submarine", len: 3 },
    { key: "destroyer", name: "Destroyer", len: 2 },
  ],
  8: [
    { key: "battleship", name: "Battleship", len: 4 },
    { key: "cruiser", name: "Cruiser", len: 3 },
    { key: "submarine", name: "Submarine", len: 3 },
    { key: "destroyer", name: "Destroyer", len: 2 },
  ],
};

export type Rng = (n: number) => number;

export const isCpu = (s: SeaSide): s is { cpu: SeaCpu; name: string } => "cpu" in s;
export const sideId = (s: SeaSide) => (isCpu(s) ? null : s.id);
const opp = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);

export function specOf(size: SeaSize, key: string): ShipSpec {
  const s = FLEETS[size].find((x) => x.key === key);
  if (!s) throw new SeaError("Unknown ship.");
  return s;
}

export function shipCells(size: number, ship: Ship, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const r = ship.dir === "v" ? ship.r + i : ship.r;
    const c = ship.dir === "h" ? ship.c + i : ship.c;
    out.push(r * size + c);
  }
  return out;
}

export function fits(size: SeaSize, ship: Ship, len: number): boolean {
  if (!Number.isInteger(ship.r) || !Number.isInteger(ship.c) || ship.r < 0 || ship.c < 0) return false;
  return ship.dir === "h" ? ship.c + len <= size && ship.r < size : ship.r + len <= size && ship.c < size;
}

/** Throws unless the fleet has every ship exactly once, on the board, without overlaps. */
export function validateFleet(size: SeaSize, fleet: Ship[]): void {
  const specs = FLEETS[size];
  if (!Array.isArray(fleet) || fleet.length !== specs.length) throw new SeaError("Place every ship.");
  const used = new Set<number>();
  for (const spec of specs) {
    const ship = fleet.find((s) => s.key === spec.key);
    if (!ship) throw new SeaError(`Place your ${spec.name}.`);
    if (ship.dir !== "h" && ship.dir !== "v") throw new SeaError("Invalid ship direction.");
    if (!fits(size, ship, spec.len)) throw new SeaError(`Your ${spec.name} doesn't fit there.`);
    for (const p of shipCells(size, ship, spec.len)) {
      if (used.has(p)) throw new SeaError("Ships can't overlap.");
      used.add(p);
    }
  }
}

export function randomFleet(size: SeaSize, rng: Rng): Ship[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const used = new Set<number>();
    const fleet: Ship[] = [];
    let ok = true;
    for (const spec of FLEETS[size]) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir: Dir = rng(2) === 0 ? "h" : "v";
        const ship = { key: spec.key, dir, r: rng(size), c: rng(size) };
        if (!fits(size, ship, spec.len)) continue;
        const cells = shipCells(size, ship, spec.len);
        if (cells.some((p) => used.has(p))) continue;
        cells.forEach((p) => used.add(p));
        fleet.push(ship);
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return fleet;
  }
  // Practically unreachable with a decent random source; a guaranteed-valid fallback.
  return FLEETS[size].map((spec, i) => ({ key: spec.key, r: i * 2, c: rng(size - spec.len + 1), dir: "h" as Dir }));
}

export function createSeaGame(a: SeaSide, b: SeaSide, size: SeaSize, rng: Rng): SeaState {
  if (size !== 8 && size !== 10) throw new SeaError("Board size must be 8 or 10.");
  const players: [SeaSide, SeaSide] = [a, b];
  const g: SeaState = {
    v: 1, kind: "sea", size, players, fleets: [null, null], first: rng(2) === 0 ? 0 : 1,
    salvos: [], phase: "setup", lastChance: false,
  };
  players.forEach((p, i) => { if (isCpu(p)) g.fleets[i] = randomFleet(size, rng); });
  return g;
}

export function seatOf(g: SeaState, playerId: string): 0 | 1 | null {
  if (sideId(g.players[0]) === playerId) return 0;
  if (sideId(g.players[1]) === playerId) return 1;
  return null;
}

export function shooterOf(g: SeaState): 0 | 1 {
  return g.salvos.length % 2 === 0 ? g.first : opp(g.first);
}

/** Shots fired AT the given seat's fleet. */
export function shotsAt(g: SeaState, seat: 0 | 1): ShotResult[] {
  return g.salvos.filter((s) => s.by !== seat).flatMap((s) => s.shots);
}

/** Keys of the given seat's ships that have been sunk. */
export function sunkShips(g: SeaState, seat: 0 | 1): Set<string> {
  const fleet = g.fleets[seat];
  if (!fleet) return new Set();
  const hits = new Set(shotsAt(g, seat).filter((s) => s.hit).map((s) => s.p));
  return new Set(fleet.filter((ship) =>
    shipCells(g.size, ship, specOf(g.size, ship.key).len).every((p) => hits.has(p))).map((s) => s.key));
}

export function shipsAfloat(g: SeaState, seat: 0 | 1): number {
  return FLEETS[g.size].length - sunkShips(g, seat).size;
}

/** How many shots the player to move may fire. */
export function shotsAllowed(g: SeaState): number {
  const shooter = shooterOf(g);
  const fired = new Set(shotsAt(g, opp(shooter)).map((s) => s.p));
  const ships = g.lastChance ? (g.finalShots ?? 1) : shipsAfloat(g, shooter);
  return Math.min(ships, g.size * g.size - fired.size);
}

export function placeFleet(g: SeaState, seat: 0 | 1, fleet: Ship[]) {
  if (g.phase !== "setup") throw new SeaError("Ships are already placed.");
  if (g.fleets[seat]) throw new SeaError("Your fleet is already placed.");
  const clean = fleet.map((s) => ({ key: String(s.key), r: Number(s.r), c: Number(s.c), dir: s.dir }));
  validateFleet(g.size, clean);
  g.fleets[seat] = clean;
  if (g.fleets[0] && g.fleets[1]) g.phase = "battle";
}

export function fire(g: SeaState, seat: 0 | 1, points: number[], now = Date.now()): Salvo {
  if (g.phase !== "battle") throw new SeaError(g.phase === "setup" ? "Wait until both fleets are placed." : "This game has finished.");
  if (shooterOf(g) !== seat) throw new SeaError("It's not your turn.");
  const target = opp(seat);
  const n = g.size * g.size;
  const already = new Set(shotsAt(g, target).map((s) => s.p));
  const pts = points.map(Number);
  const allowed = shotsAllowed(g);
  if (pts.length !== allowed) throw new SeaError(`Fire exactly ${allowed} shot${allowed === 1 ? "" : "s"}.`);
  if (new Set(pts).size !== pts.length) throw new SeaError("Pick different squares for each shot.");
  for (const p of pts) {
    if (!Number.isInteger(p) || p < 0 || p >= n) throw new SeaError("That square is off the board.");
    if (already.has(p)) throw new SeaError("You've already fired at that square.");
  }

  const sunkBefore = sunkShips(g, target);
  const fleet = g.fleets[target]!;
  const cellOwner = new Map<number, string>();
  for (const ship of fleet) for (const p of shipCells(g.size, ship, specOf(g.size, ship.key).len)) cellOwner.set(p, ship.key);
  const salvo: Salvo = { by: seat, shots: pts.map((p) => ({ p, hit: cellOwner.has(p) })), at: now };
  g.salvos.push(salvo);
  // Mark the shot that completed each newly sunk ship.
  for (const key of sunkShips(g, target)) {
    if (sunkBefore.has(key)) continue;
    const ship = fleet.find((s) => s.key === key)!;
    const cells = new Set(shipCells(g.size, ship, specOf(g.size, key).len));
    const last = [...salvo.shots].reverse().find((s) => cells.has(s.p));
    if (last) last.sunk = key;
  }

  const targetGone = shipsAfloat(g, target) === 0;
  if (g.lastChance) {
    // This was the second player's final salvo.
    g.phase = "finished";
    g.result = { winner: targetGone ? null : g.first, reason: "sunk" };
  } else if (targetGone) {
    if (seat === g.first) {
      // The opponent gets an equal number of turns, firing with the ships they had before this salvo.
      g.lastChance = true;
      g.finalShots = FLEETS[g.size].length - sunkBefore.size;
    }
    else { g.phase = "finished"; g.result = { winner: seat, reason: "sunk" }; }
  }
  return salvo;
}

export function resign(g: SeaState, seat: 0 | 1) {
  if (g.phase === "finished") throw new SeaError("This game has finished.");
  g.phase = "finished";
  g.result = { winner: opp(seat), reason: "resigned" };
}

// ------------------------------------------------------------------ computer

/** Chooses the computer's salvo. Easy: random with follow-up around hits. Smart: probability hunting. */
export function cpuSalvo(g: SeaState, seat: 0 | 1, level: SeaCpu, rng: Rng): number[] {
  const size = g.size;
  const target = opp(seat);
  const shots = shotsAt(g, target);
  const fired = new Set(shots.map((s) => s.p));
  const sunk = sunkShips(g, target);
  const fleet = g.fleets[target]!;
  // Hits on ships not yet sunk (the computer only uses what a player could know).
  const sunkCells = new Set<number>();
  for (const ship of fleet) if (sunk.has(ship.key)) shipCells(size, ship, specOf(size, ship.key).len).forEach((p) => sunkCells.add(p));
  const openHits = shots.filter((s) => s.hit && !sunkCells.has(s.p)).map((s) => s.p);
  const misses = new Set(shots.filter((s) => !s.hit).map((s) => s.p));
  const n = shotsAllowed(g);
  const free = Array.from({ length: size * size }, (_, p) => p).filter((p) => !fired.has(p));
  const pick: number[] = [];
  const take = (p: number) => { if (!pick.includes(p) && !fired.has(p) && pick.length < n) pick.push(p); };
  const nb = (p: number) => {
    const r = Math.floor(p / size), c = p % size, o: number[] = [];
    if (r > 0) o.push(p - size); if (r < size - 1) o.push(p + size);
    if (c > 0) o.push(p - 1); if (c < size - 1) o.push(p + 1);
    return o;
  };

  if (level === "easy") {
    for (const h of openHits) for (const q of nb(h)) take(q);
    while (pick.length < n) take(free[rng(free.length)]);
    return pick;
  }

  // Smart: count every placement of each remaining ship that is consistent with
  // misses and sunk ships; placements covering open hits are weighted heavily.
  const remaining = FLEETS[size].filter((s) => !sunk.has(s.key));
  const score = new Array(size * size).fill(0);
  const blocked = (p: number) => misses.has(p) || sunkCells.has(p);
  const hitSet = new Set(openHits);
  for (const spec of remaining) {
    for (const dir of ["h", "v"] as Dir[]) {
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        const ship = { key: spec.key, r, c, dir };
        if (!fits(size, ship, spec.len)) continue;
        const cells = shipCells(size, ship, spec.len);
        if (cells.some(blocked)) continue;
        const covered = cells.filter((p) => hitSet.has(p)).length;
        const w = covered ? 50 * covered : 1;
        for (const p of cells) if (!fired.has(p)) score[p] += w;
      }
    }
  }
  const order = free.map((p) => ({ p, s: score[p] + rng(1000) / 10000 })).sort((a, b) => b.s - a.s);
  for (const { p } of order) take(p);
  return pick;
}

// ------------------------------------------------------------------ view

export interface SeaView {
  id: string;
  version: number;
  kind: "sea";
  size: SeaSize;
  mySeat: 0 | 1;
  me: SeaSide;
  them: SeaSide;
  phase: SeaState["phase"];
  myTurn: boolean;
  shotsAllowed: number;
  lastChance: boolean;
  iAmFirst: boolean;
  myFleet: Ship[] | null;
  theirFleetPlaced: boolean;
  /** Their ships: only sunk ones until the game ends, then all. */
  theirShips: Ship[];
  salvos: Salvo[];
  result?: SeaState["result"];
}

export function seaViewFor(g: SeaState, playerId: string, id: string, version: number): SeaView {
  const seat = seatOf(g, playerId);
  if (seat === null) throw new SeaError("You are not in this game.");
  const them = opp(seat);
  const sunk = sunkShips(g, them);
  const theirFleet = g.fleets[them] ?? [];
  return {
    id, version, kind: "sea", size: g.size, mySeat: seat, me: g.players[seat], them: g.players[them],
    phase: g.phase,
    myTurn: g.phase === "battle" && shooterOf(g) === seat,
    shotsAllowed: g.phase === "battle" ? shotsAllowed(g) : 0,
    lastChance: g.lastChance,
    iAmFirst: g.first === seat,
    myFleet: g.fleets[seat],
    theirFleetPlaced: !!g.fleets[them],
    theirShips: g.phase === "finished" ? theirFleet : theirFleet.filter((s) => sunk.has(s.key)),
    salvos: g.salvos,
    result: g.result,
  };
}

export function describeSeaEnd(g: SeaState): string {
  if (!g.result) return "";
  if (g.result.winner === null) return "Draw: both fleets were sunk with equal turns.";
  const w = g.players[g.result.winner].name;
  return g.result.reason === "resigned"
    ? `${g.players[opp(g.result.winner)].name} resigned. ${w} wins.`
    : `${w} sank the whole fleet and wins.`;
}
