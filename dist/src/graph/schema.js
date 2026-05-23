import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const SCHEMA_VERSION = 4;
const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Entities (graph nodes)
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  properties TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT,
  confidence REAL DEFAULT 1.0,
  mention_count INTEGER DEFAULT 1,
  lifecycle TEXT DEFAULT 'active',
  last_accessed TEXT
);

-- Relationships (graph edges)
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  properties TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT,
  confidence REAL DEFAULT 1.0,
  valid_from TEXT,
  valid_until TEXT,
  lifecycle TEXT DEFAULT 'active'
);

-- Embeddings for semantic search
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  vector TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Memory log (audit trail of extractions)
CREATE TABLE IF NOT EXISTS memory_log (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  extracted_entities TEXT DEFAULT '[]',
  extracted_relations TEXT DEFAULT '[]',
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id);
CREATE INDEX IF NOT EXISTS idx_rel_relation ON relationships(relation);
CREATE INDEX IF NOT EXISTS idx_rel_pair ON relationships(from_id, to_id, relation);

-- Full-text search on entities
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  type,
  properties,
  content=entities,
  content_rowid=rowid
);

-- FTS triggers to keep in sync
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, type, properties)
  VALUES (new.rowid, new.name, new.type, new.properties);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, properties)
  VALUES ('delete', old.rowid, old.name, old.type, old.properties);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, properties)
  VALUES ('delete', old.rowid, old.name, old.type, old.properties);
  INSERT INTO entities_fts(rowid, name, type, properties)
  VALUES (new.rowid, new.name, new.type, new.properties);
END;
`;
export class SchemaManager {
    db;
    constructor(dbPath) {
        // Ensure directory exists
        const dir = resolve(dbPath, '..');
        mkdirSync(dir, { recursive: true });
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
    }
    /** Initialize schema (idempotent) */
    initialize() {
        this.db.exec(SCHEMA_SQL);
        // Migrations
        const currentVersion = this.getVersion();
        if (currentVersion < 2) {
            // Add mention_count column if missing (v1 → v2)
            try {
                this.db.exec(`ALTER TABLE entities ADD COLUMN mention_count INTEGER DEFAULT 1`);
            }
            catch (_) { /* column already exists */ }
        }
        if (currentVersion < 3) {
            // v2 → v3: Add temporal validity + lifecycle
            try {
                this.db.exec(`ALTER TABLE relationships ADD COLUMN valid_from TEXT`);
            }
            catch (_) { /* column already exists */ }
            try {
                this.db.exec(`ALTER TABLE relationships ADD COLUMN valid_until TEXT`);
            }
            catch (_) { /* column already exists */ }
            try {
                this.db.exec(`ALTER TABLE relationships ADD COLUMN lifecycle TEXT DEFAULT 'active'`);
            }
            catch (_) { /* column already exists */ }
            try {
                this.db.exec(`ALTER TABLE entities ADD COLUMN lifecycle TEXT DEFAULT 'active'`);
            }
            catch (_) { /* column already exists */ }
            try {
                this.db.exec(`ALTER TABLE entities ADD COLUMN last_accessed TEXT`);
            }
            catch (_) { /* column already exists */ }
            // Index for temporal queries
            try {
                this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_valid ON relationships(valid_from, valid_until)`);
                this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_lifecycle ON relationships(lifecycle)`);
                this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_lifecycle ON entities(lifecycle)`);
            }
            catch (_) { /* indexes already exist */ }
        }
        if (currentVersion < 4) {
            // v3 → v4: Add embeddings table for semantic search
            try {
                this.db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          vector TEXT NOT NULL,
          model TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
                this.db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_id)`);
            }
            catch (_) { /* table already exists */ }
        }
        // Set schema version
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`);
        stmt.run(String(SCHEMA_VERSION));
        return this.db;
    }
    /** Get current schema version */
    getVersion() {
        try {
            const row = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get();
            return row ? parseInt(row.value, 10) : 0;
        }
        catch {
            return 0;
        }
    }
    /** Close database connection */
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=schema.js.map