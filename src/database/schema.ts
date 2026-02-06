export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Collections: Virtual groupings of vault files
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  path TEXT NOT NULL,
  glob_pattern TEXT NOT NULL DEFAULT '**/*.md',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Path contexts: Hierarchical context annotations
CREATE TABLE IF NOT EXISTS path_contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  context TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  UNIQUE(collection_id, path)
);

-- Documents: Indexed markdown files
CREATE TABLE IF NOT EXISTS documents (
  hash TEXT PRIMARY KEY,
  collection_id INTEGER NOT NULL,
  path TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

-- FTS5 virtual table for full-text search with BM25
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  hash UNINDEXED,
  title,
  content,
  content=documents,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- FTS5 triggers to keep index in sync
CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, hash, title, content)
  VALUES (new.rowid, new.hash, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE ON documents BEGIN
  UPDATE documents_fts SET
    hash = new.hash,
    title = new.title,
    content = new.content
  WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.rowid;
END;

-- Content vectors: Chunked embeddings for documents
CREATE TABLE IF NOT EXISTS content_vectors (
  hash_seq TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  seq INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (hash) REFERENCES documents(hash) ON DELETE CASCADE
);

-- LLM cache: Store API responses to reduce costs
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 1
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(active);
CREATE INDEX IF NOT EXISTS idx_content_vectors_hash ON content_vectors(hash);
CREATE INDEX IF NOT EXISTS idx_path_contexts_collection ON path_contexts(collection_id);
`;

export const VEC0_TABLE_SQL = `
-- Vector search virtual table using vec0 (sqlite-vec)
-- Must be created separately as it requires the vec extension
CREATE VIRTUAL TABLE IF NOT EXISTS vectors_vec USING vec0(
  hash_seq TEXT PRIMARY KEY,
  embedding float[768] distance_metric=cosine
);
`;

export function getSchemaVersion(): number {
  return SCHEMA_VERSION;
}
