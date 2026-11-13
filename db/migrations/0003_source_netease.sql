-- 0003 source 枚举扩展：新增 'netease'（IM-23 / 评审案 05-系统架构设计/评审案-网易云专辑导入器.md
-- Q1 路线 B，用户 2026-11-14 追认令批准）。只追加、禁改历史迁移（0001/0002 不动）。
--
-- SQLite 不支持 ALTER CHECK → album_metadata 四步重建（官方配方 altertable.html §7）：
-- 建新表 → INSERT SELECT 原样搬移 → DROP 旧表 → RENAME 换名 + 重建索引。
-- 外键窗口：foreign_keys 事务内为 no-op（实测），故 migrate.ts 在迁移循环**事务外**临时
-- PRAGMA foreign_keys=OFF，COMMIT 后统一 PRAGMA foreign_key_check 校验兜底（零违规才算过）；
-- 基线 FK=ON 在迁移窗口结束立即恢复，connection.ts 的 PRAGMA 基线不动（IM-25）。
-- collection_record.album_id 的 REFERENCES 按表名运行期解析，RENAME 后自动重新锚定（实测零违规）。

CREATE TABLE album_metadata_new (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL CHECK (source IN ('musicbrainz', 'deezer', 'itunes', 'discogs', 'user-provided', 'netease')),
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

INSERT INTO album_metadata_new (id, source, source_id, title, artist, release_year, cover_url, cover_local, genres, country, alias_sources, created_at, updated_at)
SELECT id, source, source_id, title, artist, release_year, cover_url, cover_local, genres, country, alias_sources, created_at, updated_at
FROM album_metadata;

DROP TABLE album_metadata;
ALTER TABLE album_metadata_new RENAME TO album_metadata;
CREATE UNIQUE INDEX idx_album_source ON album_metadata (source, source_id);
