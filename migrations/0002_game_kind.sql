-- Games can now be word games or chess games.
ALTER TABLE games ADD COLUMN kind TEXT NOT NULL DEFAULT 'words';
