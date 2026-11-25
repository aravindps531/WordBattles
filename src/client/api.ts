import type { GameView, PlacedTile } from "../shared/engine";

export interface GameSummary {
  id: string;
  status: "active" | "finished";
  updatedAt: number;
  players: { id: string; name: string; score: number; resigned: boolean }[];
  turn: number;
  myTurn: boolean;
  lastMove: string | null;
  winners: number[];
  bagCount: number;
}

export interface MeResponse {
  me: { id: string; name: string };
  family: { id: string; name: string }[];
  games: GameSummary[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class Api {
  constructor(private token: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError(0, "No internet connection. Please try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
    return data as T;
  }

  me() { return this.req<MeResponse>("/api/me"); }
  game(id: string, since?: number) {
    return this.req<GameView | { unchanged: true; version: number }>(
      `/api/games/${id}${since !== undefined ? `?since=${since}` : ""}`,
    );
  }
  createGame(playerIds: string[]) {
    return this.req<{ id: string }>("/api/games", { method: "POST", body: JSON.stringify({ playerIds }) });
  }
  move(id: string, version: number, action: "play" | "pass" | "exchange" | "resign",
    extra: { tiles?: PlacedTile[]; letters?: string[] } = {}) {
    return this.req<GameView>(`/api/games/${id}/move`, {
      method: "POST", body: JSON.stringify({ version, action, ...extra }),
    });
  }
  subscribe(sub: PushSubscriptionJSON) {
    return this.req<{ ok: true }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
  }
  testPush() { return this.req<{ ok: true }>("/api/push/test", { method: "POST" }); }
}

export async function adminFetch<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "x-admin-key": key, ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}
