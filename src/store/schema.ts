// Stacks' own database: the files, positions, reading sessions, highlights and notes, and (since 2026-11-01)
// the catalog: each book's status, rating, tags, who recommended it and looked-up details. Grimoire holds none of it.

export const SCHEMA_VERSION = 1

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
INSERT OR IGNORE INTO counter (id, seq) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  file_sha256 TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  isbn TEXT,
  publisher TEXT,
  language TEXT,
  page_count INTEGER,
  ol_work TEXT,
  ol_edition TEXT,
  cover TEXT NOT NULL,
  apple_books_id TEXT,
  added_at INTEGER NOT NULL,
  lookup_state TEXT NOT NULL,
  lookup_tried_at INTEGER,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS books_apple ON books (apple_books_id);

CREATE TABLE IF NOT EXISTS positions (
  book_id TEXT NOT NULL,
  device TEXT NOT NULL,
  locator TEXT NOT NULL,
  progression REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (book_id, device)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  device TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL,
  start_progression REAL NOT NULL,
  end_progression REAL NOT NULL,
  pages_turned INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions (started_at);

CREATE TABLE IF NOT EXISTS annotations (
  annotation_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL,
  locator TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  device TEXT NOT NULL,
  source TEXT NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS annotations_book ON annotations (book_id);

CREATE TABLE IF NOT EXISTS titles (
  page_id TEXT PRIMARY KEY,
  page_title TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  rating INTEGER,
  rec TEXT,
  finished TEXT,
  progress TEXT,
  year INTEGER,
  genre TEXT,
  summary TEXT,
  author TEXT,
  apple_books TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS title_tags (
  page_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (page_id, tag)
);
CREATE TABLE IF NOT EXISTS tag_groups (
  tag TEXT PRIMARY KEY,
  group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grimoire_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS progress_writes (
  book_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  percent INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS books_seq ON books (seq);
CREATE INDEX IF NOT EXISTS positions_seq ON positions (seq);
CREATE INDEX IF NOT EXISTS sessions_seq ON sessions (seq);
CREATE INDEX IF NOT EXISTS annotations_seq ON annotations (seq);
`
