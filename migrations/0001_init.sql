-- Family members. `token` is the secret in each person's personal link.
CREATE TABLE players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

-- One row per game. `state` is the full GameState JSON (board, bag, racks, history).
-- `version` is bumped on every move for optimistic concurrency.
CREATE TABLE games (
  id          TEXT PRIMARY KEY,
  state       TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE game_players (
  game_id    TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  seat       INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX idx_game_players_player ON game_players(player_id);

-- Browser push subscriptions (a player may have several devices).
CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_push_player ON push_subscriptions(player_id);
