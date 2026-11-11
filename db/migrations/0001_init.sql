-- 0001 初始物理模式（02-数据模型与API设计.md §2，含评审 R4/R5/R9/R10 与复审 V12 修订）
-- 三条数据决定的物理执行：D1 listened_at+precision / D2 UNIQUE(user_id,album_id)+NOT NULL / D3 cover_color 枚举

CREATE TABLE album_metadata (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL CHECK (source IN ('musicbrainz', 'deezer', 'itunes', 'discogs', 'user-provided')),
  source_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL,
  release_year  INTEGER NULL CHECK (release_year IS NULL OR (release_year BETWEEN 1000 AND 3000)),
  cover_url     TEXT NULL,
  cover_local   TEXT NULL,
  genres        TEXT NULL,          -- JSON 数组；计数/筛选经 json_each 展开（评审 R3）
  country       TEXT NULL,
  alias_sources TEXT NULL,          -- JSON 数组，跨源合并（评审 R4）
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_album_source ON album_metadata (source, source_id);

CREATE TABLE collection_record (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL DEFAULT 'local',
  album_id           TEXT NOT NULL REFERENCES album_metadata (id),  -- NOT NULL 必须：SQLite 中 NULL 在 UNIQUE 组合内可重复（复审 V12）
  added_at           TEXT NOT NULL,
  listened_at        TEXT NULL,      -- 统一 YYYY-01-01T00:00:00Z 精度规范（评审 R5）；禁止裸 YYYY
  listened_precision TEXT NULL CHECK (listened_precision IN ('day', 'year')),
  note               TEXT NULL,
  is_favorite        INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  cover_color        INTEGER NULL CHECK (cover_color IS NULL OR cover_color BETWEEN 1 AND 16),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_record_user_album ON collection_record (user_id, album_id);
CREATE INDEX idx_record_user_added ON collection_record (user_id, added_at DESC);
CREATE INDEX idx_record_user_listened ON collection_record (user_id, listened_at);
CREATE INDEX idx_record_user_color ON collection_record (user_id, cover_color);
CREATE INDEX idx_record_user_favorite ON collection_record (user_id, is_favorite);

CREATE TABLE tags (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL DEFAULT 'local',
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,    -- 小写去空格，自动补全防分裂基础（AGENTS §7）
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_tags_user_norm ON tags (user_id, normalized_name);  -- 复审 V12：防同名重复插入
CREATE INDEX idx_tags_norm_prefix ON tags (user_id, normalized_name);     -- 评审 R9：前缀 LIKE（与 UNIQUE 索引并列，显式命名）

CREATE TABLE record_tag (
  record_id  TEXT NOT NULL REFERENCES collection_record (id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (record_id, tag_id)
);
CREATE INDEX idx_record_tag_tag ON record_tag (tag_id);  -- 评审 R9：按 tag 反查/计数
