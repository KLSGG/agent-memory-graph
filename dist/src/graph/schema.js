import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const SCHEMA_VERSION = 2;
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
  mention_count INTEGER DEFAULT 1
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
  confidence REAL DEFAULT 1.0
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