PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, position INTEGER DEFAULT 0, steps TEXT DEFAULT '[]', trial_level INTEGER NOT NULL DEFAULT 0, category_id INTEGER DEFAULT NULL, description TEXT, whiteboard_json TEXT, target_value INTEGER DEFAULT NULL, lap_duration INTEGER, timer_duration INTEGER DEFAULT NULL);
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
);
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    headline TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    base64_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, position INTEGER DEFAULT 0);
CREATE TABLE social_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_name TEXT NOT NULL,
    icon_base64 TEXT NOT NULL,
    -- Store key-value pairs as a stringified JSON object
    metadata TEXT NOT NULL DEFAULT '{}', 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, profile_link TEXT NOT NULL DEFAULT '');
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cdn_link TEXT NOT NULL,
  created_at TEXT
, current_page INTEGER DEFAULT 1);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT NULL,
  position INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, description TEXT,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE TABLE media_tracker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  image_base64 TEXT,
  parent_id INTEGER,
  type TEXT CHECK(type IN ('movie', 'series', 'season', 'episode')) DEFAULT 'movie',
  status TEXT CHECK(status IN ('watching', 'watched', 'planned', 'dropped')) DEFAULT 'planned',
  position INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES media_tracker(id) ON DELETE CASCADE
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_todos_position ON todos(position);
CREATE INDEX idx_todos_category_id ON todos(category_id);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_position ON categories(position);
