-- In-game chat. Messages belong to a game; only that game's players can read or write.
CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_chat_game ON chat_messages(game_id, id);

-- How far each player has read in each game's chat (for unread badges).
CREATE TABLE chat_reads (
  game_id       TEXT NOT NULL,
  player_id     TEXT NOT NULL,
  last_read_id  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, player_id)
);
