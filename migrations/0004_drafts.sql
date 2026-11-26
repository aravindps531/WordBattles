-- Word Battles "live tries": tiles a player is arranging but hasn't played yet.
-- One row per player per game; replaced on every change, removed when they play or clear.
CREATE TABLE drafts (
  game_id     TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  tiles       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
