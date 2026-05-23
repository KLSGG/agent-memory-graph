// node_modules/nanoid/index.js
import { webcrypto as crypto } from "node:crypto";

// node_modules/nanoid/url-alphabet/index.js
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

// node_modules/nanoid/index.js
var POOL_SIZE_MULTIPLIER = 128;
var pool;
var poolOffset;
function fillPool(bytes) {
  if (bytes < 0 || bytes > 1024) throw new RangeError("Wrong ID size");
  if (!pool || pool.length < bytes) {
    pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
    crypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    crypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function nanoid(size = 21) {
  fillPool(size |= 0);
  let id = "";
  for (let i = poolOffset - size; i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}

// src/graph/schema.ts
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
var SCHEMA_VERSION = 4;
var SCHEMA_SQL = `
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
var SchemaManager = class {
  db;
  constructor(dbPath) {
    const dir = resolve(dbPath, "..");
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }
  /** Initialize schema (idempotent) */
  initialize() {
    this.db.exec(SCHEMA_SQL);
    const currentVersion = this.getVersion();
    if (currentVersion < 2) {
      try {
        this.db.exec(`ALTER TABLE entities ADD COLUMN mention_count INTEGER DEFAULT 1`);
      } catch (_) {
      }
    }
    if (currentVersion < 3) {
      try {
        this.db.exec(`ALTER TABLE relationships ADD COLUMN valid_from TEXT`);
      } catch (_) {
      }
      try {
        this.db.exec(`ALTER TABLE relationships ADD COLUMN valid_until TEXT`);
      } catch (_) {
      }
      try {
        this.db.exec(`ALTER TABLE relationships ADD COLUMN lifecycle TEXT DEFAULT 'active'`);
      } catch (_) {
      }
      try {
        this.db.exec(`ALTER TABLE entities ADD COLUMN lifecycle TEXT DEFAULT 'active'`);
      } catch (_) {
      }
      try {
        this.db.exec(`ALTER TABLE entities ADD COLUMN last_accessed TEXT`);
      } catch (_) {
      }
      try {
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_valid ON relationships(valid_from, valid_until)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_rel_lifecycle ON relationships(lifecycle)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_lifecycle ON entities(lifecycle)`);
      } catch (_) {
      }
    }
    if (currentVersion < 4) {
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          vector TEXT NOT NULL,
          model TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_id)`);
      } catch (_) {
      }
    }
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`
    );
    stmt.run(String(SCHEMA_VERSION));
    return this.db;
  }
  /** Get current schema version */
  getVersion() {
    try {
      const row = this.db.prepare(
        `SELECT value FROM _meta WHERE key = 'schema_version'`
      ).get();
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      return 0;
    }
  }
  /** Close database connection */
  close() {
    this.db.close();
  }
};

// src/graph/engine.ts
var GraphEngine = class {
  db;
  constructor(dbPath) {
    const schema = new SchemaManager(dbPath);
    this.db = schema.initialize();
  }
  // ─── Entity CRUD ───────────────────────────────────────────────
  addEntity(name, type, properties = {}, options = {}) {
    const existing = this.findEntityByName(name, type);
    if (existing) {
      this.db.prepare(`UPDATE entities SET mention_count = mention_count + 1 WHERE id = ?`).run(existing.id);
      return this.updateEntity(existing.id, { properties, ...options });
    }
    const id = `e-${nanoid(12)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(`
      INSERT INTO entities (id, name, type, properties, created_at, updated_at, source, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      type,
      JSON.stringify(properties),
      now,
      now,
      options.source ?? null,
      options.confidence ?? 1
    );
    return { id, name, type, properties, created_at: now, updated_at: now, source: options.source, confidence: options.confidence ?? 1 };
  }
  getEntity(id) {
    const row = this.db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id);
    return row ? this.rowToEntity(row) : null;
  }
  findEntityByName(name, type) {
    const query = type ? `SELECT * FROM entities WHERE name = ? COLLATE NOCASE AND type = ? COLLATE NOCASE LIMIT 1` : `SELECT * FROM entities WHERE name = ? COLLATE NOCASE LIMIT 1`;
    const row = type ? this.db.prepare(query).get(name, type) : this.db.prepare(query).get(name);
    return row ? this.rowToEntity(row) : null;
  }
  updateEntity(id, updates) {
    const existing = this.getEntity(id);
    if (!existing) throw new Error(`Entity ${id} not found`);
    const merged = {
      name: updates.name ?? existing.name,
      type: updates.type ?? existing.type,
      properties: updates.properties ? { ...existing.properties, ...updates.properties } : existing.properties,
      source: updates.source ?? existing.source,
      confidence: updates.confidence ?? existing.confidence
    };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(`
      UPDATE entities SET name = ?, type = ?, properties = ?, source = ?, confidence = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.type,
      JSON.stringify(merged.properties),
      merged.source ?? null,
      merged.confidence,
      now,
      id
    );
    return { ...existing, ...merged, updated_at: now };
  }
  deleteEntity(id) {
    const result = this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
    return result.changes > 0;
  }
  reassignRelationships(fromEntityId, toEntityId) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const r1 = this.db.prepare(`UPDATE relationships SET from_id = ?, updated_at = ? WHERE from_id = ?`).run(toEntityId, now, fromEntityId);
    const r2 = this.db.prepare(`UPDATE relationships SET to_id = ?, updated_at = ? WHERE to_id = ?`).run(toEntityId, now, fromEntityId);
    this.db.prepare(`DELETE FROM relationships WHERE from_id = to_id`).run();
    return r1.changes + r2.changes;
  }
  listEntities(options = {}) {
    const { type, limit = 100, offset = 0 } = options;
    const query = type ? `SELECT * FROM entities WHERE type = ? COLLATE NOCASE ORDER BY mention_count DESC, updated_at DESC LIMIT ? OFFSET ?` : `SELECT * FROM entities ORDER BY mention_count DESC, updated_at DESC LIMIT ? OFFSET ?`;
    const rows = type ? this.db.prepare(query).all(type, limit, offset) : this.db.prepare(query).all(limit, offset);
    return rows.map((r) => this.rowToEntity(r));
  }
  // ─── Relationship CRUD ─────────────────────────────────────────
  addRelation(fromName, relation, toName, options = {}) {
    let fromEntity = this.findEntityByName(fromName);
    if (!fromEntity) {
      fromEntity = this.addEntity(fromName, options.fromType ?? "Unknown", {}, { source: options.source });
    }
    let toEntity = this.findEntityByName(toName);
    if (!toEntity) {
      toEntity = this.addEntity(toName, options.toType ?? "Unknown", {}, { source: options.source });
    }
    const existing = this.db.prepare(`
      SELECT * FROM relationships WHERE from_id = ? AND to_id = ? AND relation = ? COLLATE NOCASE AND (lifecycle = 'active' OR lifecycle IS NULL) LIMIT 1
    `).get(fromEntity.id, toEntity.id, relation);
    if (existing) {
      const now2 = (/* @__PURE__ */ new Date()).toISOString();
      const mergedProps = { ...JSON.parse(existing.properties || "{}"), ...options.properties ?? {} };
      this.db.prepare(`
        UPDATE relationships SET properties = ?, confidence = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(mergedProps), options.confidence ?? existing.confidence, now2, existing.id);
      return this.rowToRelationship({ ...existing, properties: JSON.stringify(mergedProps), updated_at: now2 });
    }
    const id = `r-${nanoid(12)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const validFrom = options.validFrom ?? now;
    this.db.prepare(`
      INSERT INTO relationships (id, from_id, to_id, relation, properties, created_at, updated_at, source, confidence, valid_from, valid_until, lifecycle)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active')
    `).run(
      id,
      fromEntity.id,
      toEntity.id,
      relation,
      JSON.stringify(options.properties ?? {}),
      now,
      now,
      options.source ?? null,
      options.confidence ?? 1,
      validFrom
    );
    return {
      id,
      from_id: fromEntity.id,
      to_id: toEntity.id,
      relation,
      properties: options.properties ?? {},
      created_at: now,
      updated_at: now,
      source: options.source,
      confidence: options.confidence ?? 1,
      valid_from: validFrom,
      valid_until: null,
      lifecycle: "active"
    };
  }
  /**
   * Invalidate a relationship (set valid_until, mark as superseded).
   * Graphiti-inspired: facts are never deleted, only invalidated.
   */
  invalidateRelation(id, reason) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const result = this.db.prepare(`
      UPDATE relationships SET valid_until = ?, lifecycle = 'superseded', updated_at = ?,
      properties = json_set(COALESCE(properties, '{}'), '$.invalidation_reason', ?)
      WHERE id = ? AND (lifecycle = 'active' OR lifecycle IS NULL)
    `).run(now, now, reason ?? "new_fact", id);
    return result.changes > 0;
  }
  /**
   * Supersede: invalidate old fact and create new one.
   * E.g., "Alice works at Google" supersedes "Alice works at Meta"
   */
  supersedeRelation(fromName, relation, oldToName, newToName, options = {}) {
    const fromEntity = this.findEntityByName(fromName);
    let invalidated = null;
    if (fromEntity) {
      const oldToEntity = this.findEntityByName(oldToName);
      if (oldToEntity) {
        const oldRel = this.db.prepare(`
          SELECT * FROM relationships WHERE from_id = ? AND to_id = ? AND relation = ? COLLATE NOCASE AND (lifecycle = 'active' OR lifecycle IS NULL) LIMIT 1
        `).get(fromEntity.id, oldToEntity.id, relation);
        if (oldRel) {
          this.invalidateRelation(oldRel.id, `superseded_by_${newToName}`);
          invalidated = this.rowToRelationship(oldRel);
        }
      }
    }
    const created = this.addRelation(fromName, relation, newToName, options);
    return { invalidated, created };
  }
  /**
   * Apply confidence decay to all entities and relationships.
   * Older items lose confidence over time. Called periodically.
   */
  applyConfidenceDecay(decayRate = 0.01, minConfidence = 0.1) {
    const now = /* @__PURE__ */ new Date();
    const entityResult = this.db.prepare(`
      UPDATE entities SET confidence = MAX(?, confidence - ?),
      lifecycle = CASE WHEN confidence - ? < 0.3 THEN 'stale' ELSE lifecycle END
      WHERE lifecycle = 'active'
      AND julianday('now') - julianday(COALESCE(last_accessed, updated_at)) > 7
    `).run(minConfidence, decayRate, decayRate);
    const relResult = this.db.prepare(`
      UPDATE relationships SET confidence = MAX(?, confidence - ?),
      lifecycle = CASE WHEN confidence - ? < 0.3 THEN 'stale' ELSE lifecycle END
      WHERE (lifecycle = 'active' OR lifecycle IS NULL)
      AND valid_until IS NULL
      AND julianday('now') - julianday(updated_at) > 14
    `).run(minConfidence, decayRate, decayRate);
    return { entitiesDecayed: entityResult.changes, relsDecayed: relResult.changes };
  }
  /**
   * Get relationships valid at a specific point in time.
   * Graphiti-inspired temporal query.
   */
  getRelationsAtTime(entityName, atTime) {
    const entity = this.findEntityByName(entityName);
    if (!entity) return [];
    const rows = this.db.prepare(`
      SELECT r.*, e.name as to_name, e.type as to_type
      FROM relationships r
      JOIN entities e ON r.to_id = e.id
      WHERE r.from_id = ?
      AND (r.valid_from IS NULL OR r.valid_from <= ?)
      AND (r.valid_until IS NULL OR r.valid_until > ?)
      ORDER BY r.confidence DESC
    `).all(entity.id, atTime, atTime);
    return rows.map((r) => ({ ...this.rowToRelationship(r), to_name: r.to_name, to_type: r.to_type }));
  }
  /**
   * Get only active (non-invalidated) relations from an entity.
   */
  getActiveRelationsFrom(entityId) {
    const rows = this.db.prepare(`
      SELECT r.*, e.name as to_name, e.type as to_type
      FROM relationships r
      JOIN entities e ON r.to_id = e.id
      WHERE r.from_id = ? AND (r.lifecycle = 'active' OR r.lifecycle IS NULL) AND r.valid_until IS NULL
      ORDER BY r.confidence DESC, r.updated_at DESC
    `).all(entityId);
    return rows.map((r) => ({ ...this.rowToRelationship(r), to_name: r.to_name, to_type: r.to_type }));
  }
  /**
   * Touch entity (update last_accessed for decay tracking)
   */
  touchEntity(id) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(`UPDATE entities SET last_accessed = ? WHERE id = ?`).run(now, id);
  }
  getRelationsFrom(entityId, includeSuperseded = false) {
    const lifecycleFilter = includeSuperseded ? "" : `AND (r.lifecycle = 'active' OR r.lifecycle IS NULL)`;
    const rows = this.db.prepare(`
      SELECT r.*, e.name as to_name, e.type as to_type
      FROM relationships r
      JOIN entities e ON r.to_id = e.id
      WHERE r.from_id = ? ${lifecycleFilter}
      ORDER BY r.confidence DESC, r.updated_at DESC
    `).all(entityId);
    return rows.map((r) => ({ ...this.rowToRelationship(r), to_name: r.to_name, to_type: r.to_type }));
  }
  getRelationsTo(entityId, includeSuperseded = false) {
    const lifecycleFilter = includeSuperseded ? "" : `AND (r.lifecycle = 'active' OR r.lifecycle IS NULL)`;
    const rows = this.db.prepare(`
      SELECT r.*, e.name as from_name, e.type as from_type
      FROM relationships r
      JOIN entities e ON r.from_id = e.id
      WHERE r.to_id = ? ${lifecycleFilter}
      ORDER BY r.confidence DESC, r.updated_at DESC
    `).all(entityId);
    return rows.map((r) => ({ ...this.rowToRelationship(r), from_name: r.from_name, from_type: r.from_type }));
  }
  deleteRelation(id) {
    const result = this.db.prepare(`DELETE FROM relationships WHERE id = ?`).run(id);
    return result.changes > 0;
  }
  // ─── Search ────────────────────────────────────────────────────
  searchEntities(query, limit = 10) {
    const sanitized = query.replace(/[?!@#$%^&*(){}\[\]<>:;"'`~|/\\+=]/g, " ").trim();
    if (sanitized.length > 0) {
      try {
        const ftsRows = this.db.prepare(`
          SELECT e.* FROM entities_fts fts
          JOIN entities e ON e.rowid = fts.rowid
          WHERE entities_fts MATCH ?
          LIMIT ?
        `).all(sanitized, limit);
        if (ftsRows.length > 0) {
          return ftsRows.map((r) => this.rowToEntity(r));
        }
      } catch {
      }
    }
    const likeQuery = sanitized.length > 0 ? sanitized : query;
    const likeRows = this.db.prepare(`
      SELECT * FROM entities
      WHERE name LIKE ? COLLATE NOCASE OR type LIKE ? COLLATE NOCASE
      LIMIT ?
    `).all(`%${likeQuery}%`, `%${likeQuery}%`, limit);
    return likeRows.map((r) => this.rowToEntity(r));
  }
  // ─── Graph Traversal ───────────────────────────────────────────
  /**
   * Find path between two entities (BFS, max depth)
   */
  findPath(fromName, toName, maxHops = 3) {
    const fromEntity = this.findEntityByName(fromName);
    const toEntity = this.findEntityByName(toName);
    if (!fromEntity || !toEntity) return null;
    const queue = [
      { entityId: fromEntity.id, path: [fromEntity.name], relations: [] }
    ];
    const visited = /* @__PURE__ */ new Set([fromEntity.id]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.path.length > maxHops + 1) break;
      const outgoing = this.db.prepare(`
        SELECT r.relation, r.to_id as neighbor_id, e.name as neighbor_name
        FROM relationships r JOIN entities e ON r.to_id = e.id
        WHERE r.from_id = ?
      `).all(current.entityId);
      const incoming = this.db.prepare(`
        SELECT r.relation, r.from_id as neighbor_id, e.name as neighbor_name
        FROM relationships r JOIN entities e ON r.from_id = e.id
        WHERE r.to_id = ?
      `).all(current.entityId);
      const neighbors = [
        ...outgoing.map((n) => ({ ...n, direction: "->" })),
        ...incoming.map((n) => ({ ...n, direction: "<-" }))
      ];
      for (const neighbor of neighbors) {
        if (neighbor.neighbor_id === toEntity.id) {
          return {
            path: [...current.path, neighbor.neighbor_name],
            relations: [...current.relations, `${neighbor.direction}[${neighbor.relation}]`]
          };
        }
        if (!visited.has(neighbor.neighbor_id)) {
          visited.add(neighbor.neighbor_id);
          queue.push({
            entityId: neighbor.neighbor_id,
            path: [...current.path, neighbor.neighbor_name],
            relations: [...current.relations, `${neighbor.direction}[${neighbor.relation}]`]
          });
        }
      }
    }
    return null;
  }
  /**
   * Get neighborhood of an entity (all connected within N hops)
   */
  getNeighborhood(entityName, hops = 1) {
    const entity = this.findEntityByName(entityName);
    if (!entity) return { entities: [], relationships: [] };
    const entityIds = /* @__PURE__ */ new Set([entity.id]);
    const relIds = /* @__PURE__ */ new Set();
    let frontier = [entity.id];
    for (let i = 0; i < hops; i++) {
      const nextFrontier = [];
      for (const nodeId of frontier) {
        const rels = this.db.prepare(`
          SELECT * FROM relationships WHERE from_id = ? OR to_id = ?
        `).all(nodeId, nodeId);
        for (const rel of rels) {
          relIds.add(rel.id);
          const neighborId = rel.from_id === nodeId ? rel.to_id : rel.from_id;
          if (!entityIds.has(neighborId)) {
            entityIds.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }
      frontier = nextFrontier;
    }
    const entities = [...entityIds].map((id) => this.getEntity(id)).filter((e) => e !== null);
    const relationships = [...relIds].map((id) => {
      const row = this.db.prepare(`SELECT * FROM relationships WHERE id = ?`).get(id);
      return row ? this.rowToRelationship(row) : null;
    }).filter((r) => r !== null);
    return { entities, relationships };
  }
  // ─── Stats ─────────────────────────────────────────────────────
  stats() {
    const entityCount = this.db.prepare(`SELECT COUNT(*) as c FROM entities`).get().c;
    const relCount = this.db.prepare(`SELECT COUNT(*) as c FROM relationships`).get().c;
    const entityTypes = this.db.prepare(`SELECT DISTINCT type FROM entities ORDER BY type`).all().map((r) => r.type);
    const relationTypes = this.db.prepare(`SELECT DISTINCT relation FROM relationships ORDER BY relation`).all().map((r) => r.relation);
    const oldest = this.db.prepare(`SELECT MIN(created_at) as t FROM entities`).get();
    const newest = this.db.prepare(`SELECT MAX(updated_at) as t FROM entities`).get();
    let activeRelationships = relCount;
    let supersededRelationships = 0;
    let staleEntities = 0;
    try {
      activeRelationships = this.db.prepare(`SELECT COUNT(*) as c FROM relationships WHERE (lifecycle = 'active' OR lifecycle IS NULL) AND valid_until IS NULL`).get().c;
      supersededRelationships = this.db.prepare(`SELECT COUNT(*) as c FROM relationships WHERE lifecycle = 'superseded' OR valid_until IS NOT NULL`).get().c;
      staleEntities = this.db.prepare(`SELECT COUNT(*) as c FROM entities WHERE lifecycle = 'stale'`).get().c;
    } catch (_) {
    }
    return {
      entities: entityCount,
      relationships: relCount,
      entityTypes,
      relationTypes,
      oldestEntry: oldest?.t ?? null,
      newestEntry: newest?.t ?? null,
      activeRelationships,
      supersededRelationships,
      staleEntities
    };
  }
  // ─── Memory Log ────────────────────────────────────────────────
  logExtraction(rawText, entities, relations, sessionId) {
    const id = `log-${nanoid(12)}`;
    this.db.prepare(`
      INSERT INTO memory_log (id, raw_text, extracted_entities, extracted_relations, session_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, rawText, JSON.stringify(entities), JSON.stringify(relations), sessionId ?? null);
  }
  // ─── Helpers ───────────────────────────────────────────────────
  rowToEntity(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      properties: JSON.parse(row.properties || "{}"),
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source ?? void 0,
      confidence: row.confidence,
      mention_count: row.mention_count ?? 1,
      lifecycle: row.lifecycle ?? "active",
      last_accessed: row.last_accessed ?? void 0
    };
  }
  rowToRelationship(row) {
    return {
      id: row.id,
      from_id: row.from_id,
      to_id: row.to_id,
      relation: row.relation,
      properties: JSON.parse(row.properties || "{}"),
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source ?? void 0,
      confidence: row.confidence,
      valid_from: row.valid_from ?? void 0,
      valid_until: row.valid_until ?? null,
      lifecycle: row.lifecycle ?? "active"
    };
  }
  /** Close database */
  close() {
    this.db.close();
  }
};

// src/search/semantic.ts
async function generateEmbedding(text, model = "text-embedding-3-small") {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "sk-local",
    baseURL: process.env.OPENAI_BASE_URL || "http://127.0.0.1:20128/v1"
  });
  const response = await client.embeddings.create({
    model,
    input: text
  });
  return response.data[0].embedding;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
async function semanticSearch(db, query, options = {}) {
  const { limit = 10, minSimilarity = 0.3, model = "text-embedding-3-small" } = options;
  let queryVector;
  try {
    queryVector = await generateEmbedding(query, model);
  } catch (err) {
    console.warn("[memory-graph] Embedding generation failed:", err.message);
    return [];
  }
  const rows = db.prepare(`
    SELECT e.id as entity_id, e.name as entity_name, e.type as entity_type, emb.vector
    FROM embeddings emb
    JOIN entities e ON emb.entity_id = e.id
    WHERE e.lifecycle = 'active' OR e.lifecycle IS NULL
  `).all();
  if (rows.length === 0) return [];
  const results = [];
  for (const row of rows) {
    const storedVector = JSON.parse(row.vector);
    const similarity = cosineSimilarity(queryVector, storedVector);
    if (similarity >= minSimilarity) {
      results.push({
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_type: row.entity_type,
        similarity
      });
    }
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

// src/mcp/server.ts
import { resolve as resolve2 } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
var DEFAULT_DB_PATH = resolve2(homedir(), ".openclaw/data/memory-graph.db");
var MCPServer = class {
  engine;
  dbPath;
  constructor(dbPath) {
    this.dbPath = dbPath || DEFAULT_DB_PATH;
    this.engine = new GraphEngine(this.dbPath);
  }
  /** List available tools (MCP tools/list) */
  listTools() {
    return {
      tools: [
        {
          name: "memory_graph_search",
          description: "Search entities in the knowledge graph by keyword or type.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search keyword" },
              type: { type: "string", description: "Filter by entity type" },
              limit: { type: "number", description: "Max results (default 10)" }
            },
            required: ["query"]
          }
        },
        {
          name: "memory_graph_query",
          description: "Ask a natural language question against the knowledge graph.",
          inputSchema: {
            type: "object",
            properties: {
              question: { type: "string", description: "Natural language question" }
            },
            required: ["question"]
          }
        },
        {
          name: "memory_graph_ingest",
          description: "Extract entities and relationships from text and store in the graph.",
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string", description: "Text to extract entities from" },
              source: { type: "string", description: "Source label" }
            },
            required: ["text"]
          }
        },
        {
          name: "memory_graph_path",
          description: "Find shortest path between two entities.",
          inputSchema: {
            type: "object",
            properties: {
              from: { type: "string", description: "Starting entity name" },
              to: { type: "string", description: "Target entity name" },
              maxHops: { type: "number", description: "Maximum hops (default 3)" }
            },
            required: ["from", "to"]
          }
        },
        {
          name: "memory_graph_stats",
          description: "Show knowledge graph statistics.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "memory_graph_temporal",
          description: "Query facts valid at a specific point in time.",
          inputSchema: {
            type: "object",
            properties: {
              entity: { type: "string", description: "Entity name" },
              at: { type: "string", description: "ISO timestamp (default: now)" },
              includeSuperseded: { type: "boolean", description: "Include invalidated facts" }
            },
            required: ["entity"]
          }
        },
        {
          name: "memory_graph_supersede",
          description: "Update a fact by superseding the old one.",
          inputSchema: {
            type: "object",
            properties: {
              entity: { type: "string", description: "Subject entity" },
              relation: { type: "string", description: "Relationship type" },
              oldTarget: { type: "string", description: "Old target (being superseded)" },
              newTarget: { type: "string", description: "New target (current truth)" },
              source: { type: "string", description: "Source label" }
            },
            required: ["entity", "relation", "oldTarget", "newTarget"]
          }
        },
        {
          name: "memory_graph_semantic_search",
          description: "Semantic/vector search for similar entities.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: { type: "number", description: "Max results (default 10)" }
            },
            required: ["query"]
          }
        }
      ]
    };
  }
  /** Execute a tool call */
  async callTool(name, args) {
    switch (name) {
      case "memory_graph_search": {
        const results = this.engine.searchEntities(args.query, args.limit || 10);
        const filtered = args.type ? results.filter((e) => e.type.toLowerCase() === args.type.toLowerCase()) : results;
        const text = filtered.length > 0 ? filtered.map((e) => `${e.name} (${e.type}) [confidence: ${(e.confidence * 100).toFixed(0)}%]`).join("\n") : `No entities found for "${args.query}"`;
        return { content: [{ type: "text", text }] };
      }
      case "memory_graph_stats": {
        const stats = this.engine.stats();
        return {
          content: [{
            type: "text",
            text: [
              `Entities: ${stats.entities} (stale: ${stats.staleEntities || 0})`,
              `Relationships: ${stats.relationships} (active: ${stats.activeRelationships}, superseded: ${stats.supersededRelationships})`,
              `Entity types: ${stats.entityTypes.join(", ")}`,
              `Oldest: ${stats.oldestEntry || "(empty)"}`,
              `Newest: ${stats.newestEntry || "(empty)"}`
            ].join("\n")
          }]
        };
      }
      case "memory_graph_path": {
        const result = this.engine.findPath(args.from, args.to, args.maxHops || 3);
        const text = result ? `Path: ${result.path.join(" \u2192 ")}
Relations: ${result.relations.join(" ")}` : `No path found between "${args.from}" and "${args.to}"`;
        return { content: [{ type: "text", text }] };
      }
      case "memory_graph_temporal": {
        const atTime = args.at || (/* @__PURE__ */ new Date()).toISOString();
        const entity = this.engine.findEntityByName(args.entity);
        if (!entity) return { content: [{ type: "text", text: `Entity "${args.entity}" not found.` }] };
        this.engine.touchEntity(entity.id);
        const rels = this.engine.getRelationsAtTime(args.entity, atTime);
        const lines = rels.map((r) => `\u2192 ${r.relation} ${r.to_name} (confidence: ${(r.confidence * 100).toFixed(0)}%)`);
        let text = `${entity.name} (${entity.type}) at ${atTime}:
${lines.join("\n") || "(no facts)"}`;
        if (args.includeSuperseded) {
          const all = this.engine.getRelationsFrom(entity.id, true);
          const superseded = all.filter((r) => r.lifecycle === "superseded" || r.valid_until);
          if (superseded.length > 0) {
            text += "\n\nSuperseded:\n" + superseded.map((r) => `\u2717 ${r.relation} ${r.to_name || r.to_id}`).join("\n");
          }
        }
        return { content: [{ type: "text", text }] };
      }
      case "memory_graph_supersede": {
        const result = this.engine.supersedeRelation(
          args.entity,
          args.relation,
          args.oldTarget,
          args.newTarget,
          { source: args.source || "mcp" }
        );
        const text = result.invalidated ? `Invalidated: ${args.entity} -[${args.relation}]-> ${args.oldTarget}
Created: ${args.entity} -[${args.relation}]-> ${args.newTarget}` : `No existing relation found. Created: ${args.entity} -[${args.relation}]-> ${args.newTarget}`;
        return { content: [{ type: "text", text }] };
      }
      case "memory_graph_semantic_search": {
        const db = this.engine.db;
        const results = await semanticSearch(db, args.query, { limit: args.limit || 10 });
        const text = results.length > 0 ? results.map((r) => `${r.entity_name} (${r.entity_type}) [similarity: ${(r.similarity * 100).toFixed(1)}%]`).join("\n") : `No semantic matches for "${args.query}" (embeddings may need to be generated first)`;
        return { content: [{ type: "text", text }] };
      }
      case "memory_graph_ingest": {
        this.engine.logExtraction(args.text, [], [], args.source);
        return { content: [{ type: "text", text: `Text logged. Full extraction requires LLM \u2014 use the OpenClaw plugin for auto-extraction.` }] };
      }
      case "memory_graph_query": {
        const results = this.engine.searchEntities(args.question, 5);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No relevant entities found for: "${args.question}"` }] };
        }
        const lines = results.map((e) => {
          const rels = this.engine.getActiveRelationsFrom(e.id);
          const relText = rels.slice(0, 3).map((r) => `\u2192 ${r.relation} ${r.to_name}`).join(", ");
          return `${e.name} (${e.type}): ${relText || "(no relations)"}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
  /** Handle a single MCP JSON-RPC request */
  async handleRequest(req) {
    try {
      switch (req.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "agent-memory-graph", version: "0.7.0" }
            }
          };
        case "tools/list":
          return { jsonrpc: "2.0", id: req.id, result: this.listTools() };
        case "tools/call": {
          const { name, arguments: args } = req.params;
          const result = await this.callTool(name, args || {});
          return { jsonrpc: "2.0", id: req.id, result };
        }
        case "notifications/initialized":
          return { jsonrpc: "2.0", id: req.id, result: {} };
        default:
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` }
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32e3, message: err.message }
      };
    }
  }
  /** Start stdio MCP server */
  start() {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      try {
        const req = JSON.parse(line);
        const res = await this.handleRequest(req);
        if (req.id !== void 0) {
          process.stdout.write(JSON.stringify(res) + "\n");
        }
      } catch (err) {
        const errorRes = {
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32700, message: "Parse error" }
        };
        process.stdout.write(JSON.stringify(errorRes) + "\n");
      }
    });
    rl.on("close", () => {
      this.engine.close();
      process.exit(0);
    });
  }
};
if (process.argv[1]?.includes("mcp") || process.argv.includes("--mcp")) {
  const dbPathIdx = process.argv.indexOf("--db-path");
  const dbPath = dbPathIdx >= 0 ? process.argv[dbPathIdx + 1] : void 0;
  const server = new MCPServer(dbPath);
  server.start();
}
export {
  MCPServer
};
