var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/nanoid/url-alphabet/index.js
var urlAlphabet;
var init_url_alphabet = __esm({
  "node_modules/nanoid/url-alphabet/index.js"() {
    urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  }
});

// node_modules/nanoid/index.js
import { webcrypto as crypto } from "node:crypto";
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
var POOL_SIZE_MULTIPLIER, pool, poolOffset;
var init_nanoid = __esm({
  "node_modules/nanoid/index.js"() {
    init_url_alphabet();
    POOL_SIZE_MULTIPLIER = 128;
  }
});

// src/graph/schema.js
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
var SCHEMA_VERSION, SCHEMA_SQL, SchemaManager;
var init_schema = __esm({
  "src/graph/schema.js"() {
    "use strict";
    SCHEMA_VERSION = 2;
    SCHEMA_SQL = `
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
    SchemaManager = class {
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
  }
});

// src/graph/engine.js
var GraphEngine;
var init_engine = __esm({
  "src/graph/engine.js"() {
    "use strict";
    init_nanoid();
    init_schema();
    GraphEngine = class {
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
      SELECT * FROM relationships WHERE from_id = ? AND to_id = ? AND relation = ? COLLATE NOCASE LIMIT 1
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
        this.db.prepare(`
      INSERT INTO relationships (id, from_id, to_id, relation, properties, created_at, updated_at, source, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
          id,
          fromEntity.id,
          toEntity.id,
          relation,
          JSON.stringify(options.properties ?? {}),
          now,
          now,
          options.source ?? null,
          options.confidence ?? 1
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
          confidence: options.confidence ?? 1
        };
      }
      getRelationsFrom(entityId) {
        const rows = this.db.prepare(`
      SELECT r.*, e.name as to_name, e.type as to_type
      FROM relationships r
      JOIN entities e ON r.to_id = e.id
      WHERE r.from_id = ?
      ORDER BY r.updated_at DESC
    `).all(entityId);
        return rows.map((r) => ({ ...this.rowToRelationship(r), to_name: r.to_name, to_type: r.to_type }));
      }
      getRelationsTo(entityId) {
        const rows = this.db.prepare(`
      SELECT r.*, e.name as from_name, e.type as from_type
      FROM relationships r
      JOIN entities e ON r.from_id = e.id
      WHERE r.to_id = ?
      ORDER BY r.updated_at DESC
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
        return {
          entities: entityCount,
          relationships: relCount,
          entityTypes,
          relationTypes,
          oldestEntry: oldest?.t ?? null,
          newestEntry: newest?.t ?? null
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
          mention_count: row.mention_count ?? 1
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
          confidence: row.confidence
        };
      }
      /** Close database */
      close() {
        this.db.close();
      }
    };
  }
});

// node_modules/zod/v3/helpers/util.js
var util, objectUtil, ZodParsedType, getParsedType;
var init_util = __esm({
  "node_modules/zod/v3/helpers/util.js"() {
    (function(util2) {
      util2.assertEqual = (_) => {
      };
      function assertIs(_arg) {
      }
      util2.assertIs = assertIs;
      function assertNever(_x) {
        throw new Error();
      }
      util2.assertNever = assertNever;
      util2.arrayToEnum = (items) => {
        const obj = {};
        for (const item of items) {
          obj[item] = item;
        }
        return obj;
      };
      util2.getValidEnumValues = (obj) => {
        const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
        const filtered = {};
        for (const k of validKeys) {
          filtered[k] = obj[k];
        }
        return util2.objectValues(filtered);
      };
      util2.objectValues = (obj) => {
        return util2.objectKeys(obj).map(function(e) {
          return obj[e];
        });
      };
      util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
        const keys = [];
        for (const key in object) {
          if (Object.prototype.hasOwnProperty.call(object, key)) {
            keys.push(key);
          }
        }
        return keys;
      };
      util2.find = (arr, checker) => {
        for (const item of arr) {
          if (checker(item))
            return item;
        }
        return void 0;
      };
      util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
      function joinValues(array, separator = " | ") {
        return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
      }
      util2.joinValues = joinValues;
      util2.jsonStringifyReplacer = (_, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };
    })(util || (util = {}));
    (function(objectUtil2) {
      objectUtil2.mergeShapes = (first, second) => {
        return {
          ...first,
          ...second
          // second overwrites first
        };
      };
    })(objectUtil || (objectUtil = {}));
    ZodParsedType = util.arrayToEnum([
      "string",
      "nan",
      "number",
      "integer",
      "float",
      "boolean",
      "date",
      "bigint",
      "symbol",
      "function",
      "undefined",
      "null",
      "array",
      "object",
      "unknown",
      "promise",
      "void",
      "never",
      "map",
      "set"
    ]);
    getParsedType = (data) => {
      const t = typeof data;
      switch (t) {
        case "undefined":
          return ZodParsedType.undefined;
        case "string":
          return ZodParsedType.string;
        case "number":
          return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
        case "boolean":
          return ZodParsedType.boolean;
        case "function":
          return ZodParsedType.function;
        case "bigint":
          return ZodParsedType.bigint;
        case "symbol":
          return ZodParsedType.symbol;
        case "object":
          if (Array.isArray(data)) {
            return ZodParsedType.array;
          }
          if (data === null) {
            return ZodParsedType.null;
          }
          if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
            return ZodParsedType.promise;
          }
          if (typeof Map !== "undefined" && data instanceof Map) {
            return ZodParsedType.map;
          }
          if (typeof Set !== "undefined" && data instanceof Set) {
            return ZodParsedType.set;
          }
          if (typeof Date !== "undefined" && data instanceof Date) {
            return ZodParsedType.date;
          }
          return ZodParsedType.object;
        default:
          return ZodParsedType.unknown;
      }
    };
  }
});

// node_modules/zod/v3/ZodError.js
var ZodIssueCode, quotelessJson, ZodError;
var init_ZodError = __esm({
  "node_modules/zod/v3/ZodError.js"() {
    init_util();
    ZodIssueCode = util.arrayToEnum([
      "invalid_type",
      "invalid_literal",
      "custom",
      "invalid_union",
      "invalid_union_discriminator",
      "invalid_enum_value",
      "unrecognized_keys",
      "invalid_arguments",
      "invalid_return_type",
      "invalid_date",
      "invalid_string",
      "too_small",
      "too_big",
      "invalid_intersection_types",
      "not_multiple_of",
      "not_finite"
    ]);
    quotelessJson = (obj) => {
      const json = JSON.stringify(obj, null, 2);
      return json.replace(/"([^"]+)":/g, "$1:");
    };
    ZodError = class _ZodError extends Error {
      get errors() {
        return this.issues;
      }
      constructor(issues) {
        super();
        this.issues = [];
        this.addIssue = (sub) => {
          this.issues = [...this.issues, sub];
        };
        this.addIssues = (subs = []) => {
          this.issues = [...this.issues, ...subs];
        };
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
          Object.setPrototypeOf(this, actualProto);
        } else {
          this.__proto__ = actualProto;
        }
        this.name = "ZodError";
        this.issues = issues;
      }
      format(_mapper) {
        const mapper = _mapper || function(issue) {
          return issue.message;
        };
        const fieldErrors = { _errors: [] };
        const processError = (error) => {
          for (const issue of error.issues) {
            if (issue.code === "invalid_union") {
              issue.unionErrors.map(processError);
            } else if (issue.code === "invalid_return_type") {
              processError(issue.returnTypeError);
            } else if (issue.code === "invalid_arguments") {
              processError(issue.argumentsError);
            } else if (issue.path.length === 0) {
              fieldErrors._errors.push(mapper(issue));
            } else {
              let curr = fieldErrors;
              let i = 0;
              while (i < issue.path.length) {
                const el = issue.path[i];
                const terminal = i === issue.path.length - 1;
                if (!terminal) {
                  curr[el] = curr[el] || { _errors: [] };
                } else {
                  curr[el] = curr[el] || { _errors: [] };
                  curr[el]._errors.push(mapper(issue));
                }
                curr = curr[el];
                i++;
              }
            }
          }
        };
        processError(this);
        return fieldErrors;
      }
      static assert(value) {
        if (!(value instanceof _ZodError)) {
          throw new Error(`Not a ZodError: ${value}`);
        }
      }
      toString() {
        return this.message;
      }
      get message() {
        return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
      }
      get isEmpty() {
        return this.issues.length === 0;
      }
      flatten(mapper = (issue) => issue.message) {
        const fieldErrors = {};
        const formErrors = [];
        for (const sub of this.issues) {
          if (sub.path.length > 0) {
            const firstEl = sub.path[0];
            fieldErrors[firstEl] = fieldErrors[firstEl] || [];
            fieldErrors[firstEl].push(mapper(sub));
          } else {
            formErrors.push(mapper(sub));
          }
        }
        return { formErrors, fieldErrors };
      }
      get formErrors() {
        return this.flatten();
      }
    };
    ZodError.create = (issues) => {
      const error = new ZodError(issues);
      return error;
    };
  }
});

// node_modules/zod/v3/locales/en.js
var errorMap, en_default;
var init_en = __esm({
  "node_modules/zod/v3/locales/en.js"() {
    init_ZodError();
    init_util();
    errorMap = (issue, _ctx) => {
      let message;
      switch (issue.code) {
        case ZodIssueCode.invalid_type:
          if (issue.received === ZodParsedType.undefined) {
            message = "Required";
          } else {
            message = `Expected ${issue.expected}, received ${issue.received}`;
          }
          break;
        case ZodIssueCode.invalid_literal:
          message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
          break;
        case ZodIssueCode.unrecognized_keys:
          message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
          break;
        case ZodIssueCode.invalid_union:
          message = `Invalid input`;
          break;
        case ZodIssueCode.invalid_union_discriminator:
          message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
          break;
        case ZodIssueCode.invalid_enum_value:
          message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
          break;
        case ZodIssueCode.invalid_arguments:
          message = `Invalid function arguments`;
          break;
        case ZodIssueCode.invalid_return_type:
          message = `Invalid function return type`;
          break;
        case ZodIssueCode.invalid_date:
          message = `Invalid date`;
          break;
        case ZodIssueCode.invalid_string:
          if (typeof issue.validation === "object") {
            if ("includes" in issue.validation) {
              message = `Invalid input: must include "${issue.validation.includes}"`;
              if (typeof issue.validation.position === "number") {
                message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
              }
            } else if ("startsWith" in issue.validation) {
              message = `Invalid input: must start with "${issue.validation.startsWith}"`;
            } else if ("endsWith" in issue.validation) {
              message = `Invalid input: must end with "${issue.validation.endsWith}"`;
            } else {
              util.assertNever(issue.validation);
            }
          } else if (issue.validation !== "regex") {
            message = `Invalid ${issue.validation}`;
          } else {
            message = "Invalid";
          }
          break;
        case ZodIssueCode.too_small:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "bigint")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
          else
            message = "Invalid input";
          break;
        case ZodIssueCode.too_big:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "bigint")
            message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
          else
            message = "Invalid input";
          break;
        case ZodIssueCode.custom:
          message = `Invalid input`;
          break;
        case ZodIssueCode.invalid_intersection_types:
          message = `Intersection results could not be merged`;
          break;
        case ZodIssueCode.not_multiple_of:
          message = `Number must be a multiple of ${issue.multipleOf}`;
          break;
        case ZodIssueCode.not_finite:
          message = "Number must be finite";
          break;
        default:
          message = _ctx.defaultError;
          util.assertNever(issue);
      }
      return { message };
    };
    en_default = errorMap;
  }
});

// node_modules/zod/v3/errors.js
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var overrideErrorMap;
var init_errors = __esm({
  "node_modules/zod/v3/errors.js"() {
    init_en();
    overrideErrorMap = en_default;
  }
});

// node_modules/zod/v3/helpers/parseUtil.js
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var makeIssue, EMPTY_PATH, ParseStatus, INVALID, DIRTY, OK, isAborted, isDirty, isValid, isAsync;
var init_parseUtil = __esm({
  "node_modules/zod/v3/helpers/parseUtil.js"() {
    init_errors();
    init_en();
    makeIssue = (params) => {
      const { data, path, errorMaps, issueData } = params;
      const fullPath = [...path, ...issueData.path || []];
      const fullIssue = {
        ...issueData,
        path: fullPath
      };
      if (issueData.message !== void 0) {
        return {
          ...issueData,
          path: fullPath,
          message: issueData.message
        };
      }
      let errorMessage = "";
      const maps = errorMaps.filter((m) => !!m).slice().reverse();
      for (const map of maps) {
        errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
      }
      return {
        ...issueData,
        path: fullPath,
        message: errorMessage
      };
    };
    EMPTY_PATH = [];
    ParseStatus = class _ParseStatus {
      constructor() {
        this.value = "valid";
      }
      dirty() {
        if (this.value === "valid")
          this.value = "dirty";
      }
      abort() {
        if (this.value !== "aborted")
          this.value = "aborted";
      }
      static mergeArray(status, results) {
        const arrayValue = [];
        for (const s of results) {
          if (s.status === "aborted")
            return INVALID;
          if (s.status === "dirty")
            status.dirty();
          arrayValue.push(s.value);
        }
        return { status: status.value, value: arrayValue };
      }
      static async mergeObjectAsync(status, pairs) {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value
          });
        }
        return _ParseStatus.mergeObjectSync(status, syncPairs);
      }
      static mergeObjectSync(status, pairs) {
        const finalObject = {};
        for (const pair of pairs) {
          const { key, value } = pair;
          if (key.status === "aborted")
            return INVALID;
          if (value.status === "aborted")
            return INVALID;
          if (key.status === "dirty")
            status.dirty();
          if (value.status === "dirty")
            status.dirty();
          if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
            finalObject[key.value] = value.value;
          }
        }
        return { status: status.value, value: finalObject };
      }
    };
    INVALID = Object.freeze({
      status: "aborted"
    });
    DIRTY = (value) => ({ status: "dirty", value });
    OK = (value) => ({ status: "valid", value });
    isAborted = (x) => x.status === "aborted";
    isDirty = (x) => x.status === "dirty";
    isValid = (x) => x.status === "valid";
    isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
  }
});

// node_modules/zod/v3/helpers/typeAliases.js
var init_typeAliases = __esm({
  "node_modules/zod/v3/helpers/typeAliases.js"() {
  }
});

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
var init_errorUtil = __esm({
  "node_modules/zod/v3/helpers/errorUtil.js"() {
    (function(errorUtil2) {
      errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
      errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
    })(errorUtil || (errorUtil = {}));
  }
});

// node_modules/zod/v3/types.js
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var ParseInputLazyPath, handleResult, ZodType, cuidRegex, cuid2Regex, ulidRegex, uuidRegex, nanoidRegex, jwtRegex, durationRegex, emailRegex, _emojiRegex, emojiRegex, ipv4Regex, ipv4CidrRegex, ipv6Regex, ipv6CidrRegex, base64Regex, base64urlRegex, dateRegexSource, dateRegex, ZodString, ZodNumber, ZodBigInt, ZodBoolean, ZodDate, ZodSymbol, ZodUndefined, ZodNull, ZodAny, ZodUnknown, ZodNever, ZodVoid, ZodArray, ZodObject, ZodUnion, getDiscriminator, ZodDiscriminatedUnion, ZodIntersection, ZodTuple, ZodRecord, ZodMap, ZodSet, ZodFunction, ZodLazy, ZodLiteral, ZodEnum, ZodNativeEnum, ZodPromise, ZodEffects, ZodOptional, ZodNullable, ZodDefault, ZodCatch, ZodNaN, BRAND, ZodBranded, ZodPipeline, ZodReadonly, late, ZodFirstPartyTypeKind, instanceOfType, stringType, numberType, nanType, bigIntType, booleanType, dateType, symbolType, undefinedType, nullType, anyType, unknownType, neverType, voidType, arrayType, objectType, strictObjectType, unionType, discriminatedUnionType, intersectionType, tupleType, recordType, mapType, setType, functionType, lazyType, literalType, enumType, nativeEnumType, promiseType, effectsType, optionalType, nullableType, preprocessType, pipelineType, ostring, onumber, oboolean, coerce, NEVER;
var init_types = __esm({
  "node_modules/zod/v3/types.js"() {
    init_ZodError();
    init_errors();
    init_errorUtil();
    init_parseUtil();
    init_util();
    ParseInputLazyPath = class {
      constructor(parent, value, path, key) {
        this._cachedPath = [];
        this.parent = parent;
        this.data = value;
        this._path = path;
        this._key = key;
      }
      get path() {
        if (!this._cachedPath.length) {
          if (Array.isArray(this._key)) {
            this._cachedPath.push(...this._path, ...this._key);
          } else {
            this._cachedPath.push(...this._path, this._key);
          }
        }
        return this._cachedPath;
      }
    };
    handleResult = (ctx, result) => {
      if (isValid(result)) {
        return { success: true, data: result.value };
      } else {
        if (!ctx.common.issues.length) {
          throw new Error("Validation failed but no issues detected.");
        }
        return {
          success: false,
          get error() {
            if (this._error)
              return this._error;
            const error = new ZodError(ctx.common.issues);
            this._error = error;
            return this._error;
          }
        };
      }
    };
    ZodType = class {
      get description() {
        return this._def.description;
      }
      _getType(input) {
        return getParsedType(input.data);
      }
      _getOrReturnCtx(input, ctx) {
        return ctx || {
          common: input.parent.common,
          data: input.data,
          parsedType: getParsedType(input.data),
          schemaErrorMap: this._def.errorMap,
          path: input.path,
          parent: input.parent
        };
      }
      _processInputParams(input) {
        return {
          status: new ParseStatus(),
          ctx: {
            common: input.parent.common,
            data: input.data,
            parsedType: getParsedType(input.data),
            schemaErrorMap: this._def.errorMap,
            path: input.path,
            parent: input.parent
          }
        };
      }
      _parseSync(input) {
        const result = this._parse(input);
        if (isAsync(result)) {
          throw new Error("Synchronous parse encountered promise.");
        }
        return result;
      }
      _parseAsync(input) {
        const result = this._parse(input);
        return Promise.resolve(result);
      }
      parse(data, params) {
        const result = this.safeParse(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      safeParse(data, params) {
        const ctx = {
          common: {
            issues: [],
            async: params?.async ?? false,
            contextualErrorMap: params?.errorMap
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        const result = this._parseSync({ data, path: ctx.path, parent: ctx });
        return handleResult(ctx, result);
      }
      "~validate"(data) {
        const ctx = {
          common: {
            issues: [],
            async: !!this["~standard"].async
          },
          path: [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        if (!this["~standard"].async) {
          try {
            const result = this._parseSync({ data, path: [], parent: ctx });
            return isValid(result) ? {
              value: result.value
            } : {
              issues: ctx.common.issues
            };
          } catch (err) {
            if (err?.message?.toLowerCase()?.includes("encountered")) {
              this["~standard"].async = true;
            }
            ctx.common = {
              issues: [],
              async: true
            };
          }
        }
        return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        });
      }
      async parseAsync(data, params) {
        const result = await this.safeParseAsync(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      async safeParseAsync(data, params) {
        const ctx = {
          common: {
            issues: [],
            contextualErrorMap: params?.errorMap,
            async: true
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
        const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
        return handleResult(ctx, result);
      }
      refine(check, message) {
        const getIssueProperties = (val) => {
          if (typeof message === "string" || typeof message === "undefined") {
            return { message };
          } else if (typeof message === "function") {
            return message(val);
          } else {
            return message;
          }
        };
        return this._refinement((val, ctx) => {
          const result = check(val);
          const setError = () => ctx.addIssue({
            code: ZodIssueCode.custom,
            ...getIssueProperties(val)
          });
          if (typeof Promise !== "undefined" && result instanceof Promise) {
            return result.then((data) => {
              if (!data) {
                setError();
                return false;
              } else {
                return true;
              }
            });
          }
          if (!result) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      refinement(check, refinementData) {
        return this._refinement((val, ctx) => {
          if (!check(val)) {
            ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
            return false;
          } else {
            return true;
          }
        });
      }
      _refinement(refinement) {
        return new ZodEffects({
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "refinement", refinement }
        });
      }
      superRefine(refinement) {
        return this._refinement(refinement);
      }
      constructor(def) {
        this.spa = this.safeParseAsync;
        this._def = def;
        this.parse = this.parse.bind(this);
        this.safeParse = this.safeParse.bind(this);
        this.parseAsync = this.parseAsync.bind(this);
        this.safeParseAsync = this.safeParseAsync.bind(this);
        this.spa = this.spa.bind(this);
        this.refine = this.refine.bind(this);
        this.refinement = this.refinement.bind(this);
        this.superRefine = this.superRefine.bind(this);
        this.optional = this.optional.bind(this);
        this.nullable = this.nullable.bind(this);
        this.nullish = this.nullish.bind(this);
        this.array = this.array.bind(this);
        this.promise = this.promise.bind(this);
        this.or = this.or.bind(this);
        this.and = this.and.bind(this);
        this.transform = this.transform.bind(this);
        this.brand = this.brand.bind(this);
        this.default = this.default.bind(this);
        this.catch = this.catch.bind(this);
        this.describe = this.describe.bind(this);
        this.pipe = this.pipe.bind(this);
        this.readonly = this.readonly.bind(this);
        this.isNullable = this.isNullable.bind(this);
        this.isOptional = this.isOptional.bind(this);
        this["~standard"] = {
          version: 1,
          vendor: "zod",
          validate: (data) => this["~validate"](data)
        };
      }
      optional() {
        return ZodOptional.create(this, this._def);
      }
      nullable() {
        return ZodNullable.create(this, this._def);
      }
      nullish() {
        return this.nullable().optional();
      }
      array() {
        return ZodArray.create(this);
      }
      promise() {
        return ZodPromise.create(this, this._def);
      }
      or(option) {
        return ZodUnion.create([this, option], this._def);
      }
      and(incoming) {
        return ZodIntersection.create(this, incoming, this._def);
      }
      transform(transform) {
        return new ZodEffects({
          ...processCreateParams(this._def),
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "transform", transform }
        });
      }
      default(def) {
        const defaultValueFunc = typeof def === "function" ? def : () => def;
        return new ZodDefault({
          ...processCreateParams(this._def),
          innerType: this,
          defaultValue: defaultValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodDefault
        });
      }
      brand() {
        return new ZodBranded({
          typeName: ZodFirstPartyTypeKind.ZodBranded,
          type: this,
          ...processCreateParams(this._def)
        });
      }
      catch(def) {
        const catchValueFunc = typeof def === "function" ? def : () => def;
        return new ZodCatch({
          ...processCreateParams(this._def),
          innerType: this,
          catchValue: catchValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodCatch
        });
      }
      describe(description) {
        const This = this.constructor;
        return new This({
          ...this._def,
          description
        });
      }
      pipe(target) {
        return ZodPipeline.create(this, target);
      }
      readonly() {
        return ZodReadonly.create(this);
      }
      isOptional() {
        return this.safeParse(void 0).success;
      }
      isNullable() {
        return this.safeParse(null).success;
      }
    };
    cuidRegex = /^c[^\s-]{8,}$/i;
    cuid2Regex = /^[0-9a-z]+$/;
    ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
    uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
    nanoidRegex = /^[a-z0-9_-]{21}$/i;
    jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
    _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
    ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
    ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
    dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
    dateRegex = new RegExp(`^${dateRegexSource}$`);
    ZodString = class _ZodString extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = String(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.string) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.string,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        const status = new ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.length < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.length > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "length") {
            const tooBig = input.data.length > check.value;
            const tooSmall = input.data.length < check.value;
            if (tooBig || tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              if (tooBig) {
                addIssueToContext(ctx, {
                  code: ZodIssueCode.too_big,
                  maximum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              } else if (tooSmall) {
                addIssueToContext(ctx, {
                  code: ZodIssueCode.too_small,
                  minimum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              }
              status.dirty();
            }
          } else if (check.kind === "email") {
            if (!emailRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "email",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "emoji") {
            if (!emojiRegex) {
              emojiRegex = new RegExp(_emojiRegex, "u");
            }
            if (!emojiRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "emoji",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "uuid") {
            if (!uuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "uuid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "nanoid") {
            if (!nanoidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "nanoid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid") {
            if (!cuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cuid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid2") {
            if (!cuid2Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cuid2",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ulid") {
            if (!ulidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "ulid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "url") {
            try {
              new URL(input.data);
            } catch {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "url",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "regex") {
            check.regex.lastIndex = 0;
            const testResult = check.regex.test(input.data);
            if (!testResult) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "regex",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "trim") {
            input.data = input.data.trim();
          } else if (check.kind === "includes") {
            if (!input.data.includes(check.value, check.position)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { includes: check.value, position: check.position },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "toLowerCase") {
            input.data = input.data.toLowerCase();
          } else if (check.kind === "toUpperCase") {
            input.data = input.data.toUpperCase();
          } else if (check.kind === "startsWith") {
            if (!input.data.startsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { startsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "endsWith") {
            if (!input.data.endsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { endsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "datetime") {
            const regex = datetimeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "datetime",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "date") {
            const regex = dateRegex;
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "date",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "time") {
            const regex = timeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "time",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "duration") {
            if (!durationRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "duration",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ip") {
            if (!isValidIP(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "ip",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "jwt") {
            if (!isValidJWT(input.data, check.alg)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "jwt",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cidr") {
            if (!isValidCidr(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cidr",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64") {
            if (!base64Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "base64",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64url") {
            if (!base64urlRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "base64url",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _regex(regex, validation, message) {
        return this.refinement((data) => regex.test(data), {
          validation,
          code: ZodIssueCode.invalid_string,
          ...errorUtil.errToObj(message)
        });
      }
      _addCheck(check) {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      email(message) {
        return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
      }
      url(message) {
        return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
      }
      emoji(message) {
        return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
      }
      uuid(message) {
        return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
      }
      nanoid(message) {
        return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
      }
      cuid(message) {
        return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
      }
      cuid2(message) {
        return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
      }
      ulid(message) {
        return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
      }
      base64(message) {
        return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
      }
      base64url(message) {
        return this._addCheck({
          kind: "base64url",
          ...errorUtil.errToObj(message)
        });
      }
      jwt(options) {
        return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
      }
      ip(options) {
        return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
      }
      cidr(options) {
        return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
      }
      datetime(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "datetime",
            precision: null,
            offset: false,
            local: false,
            message: options
          });
        }
        return this._addCheck({
          kind: "datetime",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          offset: options?.offset ?? false,
          local: options?.local ?? false,
          ...errorUtil.errToObj(options?.message)
        });
      }
      date(message) {
        return this._addCheck({ kind: "date", message });
      }
      time(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "time",
            precision: null,
            message: options
          });
        }
        return this._addCheck({
          kind: "time",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          ...errorUtil.errToObj(options?.message)
        });
      }
      duration(message) {
        return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
      }
      regex(regex, message) {
        return this._addCheck({
          kind: "regex",
          regex,
          ...errorUtil.errToObj(message)
        });
      }
      includes(value, options) {
        return this._addCheck({
          kind: "includes",
          value,
          position: options?.position,
          ...errorUtil.errToObj(options?.message)
        });
      }
      startsWith(value, message) {
        return this._addCheck({
          kind: "startsWith",
          value,
          ...errorUtil.errToObj(message)
        });
      }
      endsWith(value, message) {
        return this._addCheck({
          kind: "endsWith",
          value,
          ...errorUtil.errToObj(message)
        });
      }
      min(minLength, message) {
        return this._addCheck({
          kind: "min",
          value: minLength,
          ...errorUtil.errToObj(message)
        });
      }
      max(maxLength, message) {
        return this._addCheck({
          kind: "max",
          value: maxLength,
          ...errorUtil.errToObj(message)
        });
      }
      length(len, message) {
        return this._addCheck({
          kind: "length",
          value: len,
          ...errorUtil.errToObj(message)
        });
      }
      /**
       * Equivalent to `.min(1)`
       */
      nonempty(message) {
        return this.min(1, errorUtil.errToObj(message));
      }
      trim() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "trim" }]
        });
      }
      toLowerCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toLowerCase" }]
        });
      }
      toUpperCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toUpperCase" }]
        });
      }
      get isDatetime() {
        return !!this._def.checks.find((ch) => ch.kind === "datetime");
      }
      get isDate() {
        return !!this._def.checks.find((ch) => ch.kind === "date");
      }
      get isTime() {
        return !!this._def.checks.find((ch) => ch.kind === "time");
      }
      get isDuration() {
        return !!this._def.checks.find((ch) => ch.kind === "duration");
      }
      get isEmail() {
        return !!this._def.checks.find((ch) => ch.kind === "email");
      }
      get isURL() {
        return !!this._def.checks.find((ch) => ch.kind === "url");
      }
      get isEmoji() {
        return !!this._def.checks.find((ch) => ch.kind === "emoji");
      }
      get isUUID() {
        return !!this._def.checks.find((ch) => ch.kind === "uuid");
      }
      get isNANOID() {
        return !!this._def.checks.find((ch) => ch.kind === "nanoid");
      }
      get isCUID() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid");
      }
      get isCUID2() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid2");
      }
      get isULID() {
        return !!this._def.checks.find((ch) => ch.kind === "ulid");
      }
      get isIP() {
        return !!this._def.checks.find((ch) => ch.kind === "ip");
      }
      get isCIDR() {
        return !!this._def.checks.find((ch) => ch.kind === "cidr");
      }
      get isBase64() {
        return !!this._def.checks.find((ch) => ch.kind === "base64");
      }
      get isBase64url() {
        return !!this._def.checks.find((ch) => ch.kind === "base64url");
      }
      get minLength() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxLength() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    ZodString.create = (params) => {
      return new ZodString({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodString,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    ZodNumber = class _ZodNumber extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
        this.step = this.multipleOf;
      }
      _parse(input) {
        if (this._def.coerce) {
          input.data = Number(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.number) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.number,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        let ctx = void 0;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "int") {
            if (!util.isInteger(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: "integer",
                received: "float",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (floatSafeRemainder(input.data, check.value) !== 0) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "finite") {
            if (!Number.isFinite(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_finite,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodNumber({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodNumber({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      int(message) {
        return this._addCheck({
          kind: "int",
          message: errorUtil.toString(message)
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil.toString(message)
        });
      }
      finite(message) {
        return this._addCheck({
          kind: "finite",
          message: errorUtil.toString(message)
        });
      }
      safe(message) {
        return this._addCheck({
          kind: "min",
          inclusive: true,
          value: Number.MIN_SAFE_INTEGER,
          message: errorUtil.toString(message)
        })._addCheck({
          kind: "max",
          inclusive: true,
          value: Number.MAX_SAFE_INTEGER,
          message: errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
      get isInt() {
        return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
      }
      get isFinite() {
        let max = null;
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
            return true;
          } else if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          } else if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return Number.isFinite(min) && Number.isFinite(max);
      }
    };
    ZodNumber.create = (params) => {
      return new ZodNumber({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodNumber,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    ZodBigInt = class _ZodBigInt extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
      }
      _parse(input) {
        if (this._def.coerce) {
          try {
            input.data = BigInt(input.data);
          } catch {
            return this._getInvalidInput(input);
          }
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.bigint) {
          return this._getInvalidInput(input);
        }
        let ctx = void 0;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                type: "bigint",
                minimum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                type: "bigint",
                maximum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (input.data % check.value !== BigInt(0)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _getInvalidInput(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.bigint,
          received: ctx.parsedType
        });
        return INVALID;
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodBigInt({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodBigInt({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    ZodBigInt.create = (params) => {
      return new ZodBigInt({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodBigInt,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    ZodBoolean = class extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = Boolean(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.boolean) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.boolean,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodBoolean.create = (params) => {
      return new ZodBoolean({
        typeName: ZodFirstPartyTypeKind.ZodBoolean,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    ZodDate = class _ZodDate extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = new Date(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.date) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.date,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        if (Number.isNaN(input.data.getTime())) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_date
          });
          return INVALID;
        }
        const status = new ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.getTime() < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                message: check.message,
                inclusive: true,
                exact: false,
                minimum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.getTime() > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                message: check.message,
                inclusive: true,
                exact: false,
                maximum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return {
          status: status.value,
          value: new Date(input.data.getTime())
        };
      }
      _addCheck(check) {
        return new _ZodDate({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      min(minDate, message) {
        return this._addCheck({
          kind: "min",
          value: minDate.getTime(),
          message: errorUtil.toString(message)
        });
      }
      max(maxDate, message) {
        return this._addCheck({
          kind: "max",
          value: maxDate.getTime(),
          message: errorUtil.toString(message)
        });
      }
      get minDate() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min != null ? new Date(min) : null;
      }
      get maxDate() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max != null ? new Date(max) : null;
      }
    };
    ZodDate.create = (params) => {
      return new ZodDate({
        checks: [],
        coerce: params?.coerce || false,
        typeName: ZodFirstPartyTypeKind.ZodDate,
        ...processCreateParams(params)
      });
    };
    ZodSymbol = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.symbol) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.symbol,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodSymbol.create = (params) => {
      return new ZodSymbol({
        typeName: ZodFirstPartyTypeKind.ZodSymbol,
        ...processCreateParams(params)
      });
    };
    ZodUndefined = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.undefined,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodUndefined.create = (params) => {
      return new ZodUndefined({
        typeName: ZodFirstPartyTypeKind.ZodUndefined,
        ...processCreateParams(params)
      });
    };
    ZodNull = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.null) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.null,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodNull.create = (params) => {
      return new ZodNull({
        typeName: ZodFirstPartyTypeKind.ZodNull,
        ...processCreateParams(params)
      });
    };
    ZodAny = class extends ZodType {
      constructor() {
        super(...arguments);
        this._any = true;
      }
      _parse(input) {
        return OK(input.data);
      }
    };
    ZodAny.create = (params) => {
      return new ZodAny({
        typeName: ZodFirstPartyTypeKind.ZodAny,
        ...processCreateParams(params)
      });
    };
    ZodUnknown = class extends ZodType {
      constructor() {
        super(...arguments);
        this._unknown = true;
      }
      _parse(input) {
        return OK(input.data);
      }
    };
    ZodUnknown.create = (params) => {
      return new ZodUnknown({
        typeName: ZodFirstPartyTypeKind.ZodUnknown,
        ...processCreateParams(params)
      });
    };
    ZodNever = class extends ZodType {
      _parse(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.never,
          received: ctx.parsedType
        });
        return INVALID;
      }
    };
    ZodNever.create = (params) => {
      return new ZodNever({
        typeName: ZodFirstPartyTypeKind.ZodNever,
        ...processCreateParams(params)
      });
    };
    ZodVoid = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.void,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodVoid.create = (params) => {
      return new ZodVoid({
        typeName: ZodFirstPartyTypeKind.ZodVoid,
        ...processCreateParams(params)
      });
    };
    ZodArray = class _ZodArray extends ZodType {
      _parse(input) {
        const { ctx, status } = this._processInputParams(input);
        const def = this._def;
        if (ctx.parsedType !== ZodParsedType.array) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.array,
            received: ctx.parsedType
          });
          return INVALID;
        }
        if (def.exactLength !== null) {
          const tooBig = ctx.data.length > def.exactLength.value;
          const tooSmall = ctx.data.length < def.exactLength.value;
          if (tooBig || tooSmall) {
            addIssueToContext(ctx, {
              code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
              minimum: tooSmall ? def.exactLength.value : void 0,
              maximum: tooBig ? def.exactLength.value : void 0,
              type: "array",
              inclusive: true,
              exact: true,
              message: def.exactLength.message
            });
            status.dirty();
          }
        }
        if (def.minLength !== null) {
          if (ctx.data.length < def.minLength.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: def.minLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.minLength.message
            });
            status.dirty();
          }
        }
        if (def.maxLength !== null) {
          if (ctx.data.length > def.maxLength.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: def.maxLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.maxLength.message
            });
            status.dirty();
          }
        }
        if (ctx.common.async) {
          return Promise.all([...ctx.data].map((item, i) => {
            return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
          })).then((result2) => {
            return ParseStatus.mergeArray(status, result2);
          });
        }
        const result = [...ctx.data].map((item, i) => {
          return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        });
        return ParseStatus.mergeArray(status, result);
      }
      get element() {
        return this._def.type;
      }
      min(minLength, message) {
        return new _ZodArray({
          ...this._def,
          minLength: { value: minLength, message: errorUtil.toString(message) }
        });
      }
      max(maxLength, message) {
        return new _ZodArray({
          ...this._def,
          maxLength: { value: maxLength, message: errorUtil.toString(message) }
        });
      }
      length(len, message) {
        return new _ZodArray({
          ...this._def,
          exactLength: { value: len, message: errorUtil.toString(message) }
        });
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    ZodArray.create = (schema, params) => {
      return new ZodArray({
        type: schema,
        minLength: null,
        maxLength: null,
        exactLength: null,
        typeName: ZodFirstPartyTypeKind.ZodArray,
        ...processCreateParams(params)
      });
    };
    ZodObject = class _ZodObject extends ZodType {
      constructor() {
        super(...arguments);
        this._cached = null;
        this.nonstrict = this.passthrough;
        this.augment = this.extend;
      }
      _getCached() {
        if (this._cached !== null)
          return this._cached;
        const shape = this._def.shape();
        const keys = util.objectKeys(shape);
        this._cached = { shape, keys };
        return this._cached;
      }
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.object) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        const { status, ctx } = this._processInputParams(input);
        const { shape, keys: shapeKeys } = this._getCached();
        const extraKeys = [];
        if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
          for (const key in ctx.data) {
            if (!shapeKeys.includes(key)) {
              extraKeys.push(key);
            }
          }
        }
        const pairs = [];
        for (const key of shapeKeys) {
          const keyValidator = shape[key];
          const value = ctx.data[key];
          pairs.push({
            key: { status: "valid", value: key },
            value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (this._def.catchall instanceof ZodNever) {
          const unknownKeys = this._def.unknownKeys;
          if (unknownKeys === "passthrough") {
            for (const key of extraKeys) {
              pairs.push({
                key: { status: "valid", value: key },
                value: { status: "valid", value: ctx.data[key] }
              });
            }
          } else if (unknownKeys === "strict") {
            if (extraKeys.length > 0) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.unrecognized_keys,
                keys: extraKeys
              });
              status.dirty();
            }
          } else if (unknownKeys === "strip") {
          } else {
            throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
          }
        } else {
          const catchall = this._def.catchall;
          for (const key of extraKeys) {
            const value = ctx.data[key];
            pairs.push({
              key: { status: "valid", value: key },
              value: catchall._parse(
                new ParseInputLazyPath(ctx, value, ctx.path, key)
                //, ctx.child(key), value, getParsedType(value)
              ),
              alwaysSet: key in ctx.data
            });
          }
        }
        if (ctx.common.async) {
          return Promise.resolve().then(async () => {
            const syncPairs = [];
            for (const pair of pairs) {
              const key = await pair.key;
              const value = await pair.value;
              syncPairs.push({
                key,
                value,
                alwaysSet: pair.alwaysSet
              });
            }
            return syncPairs;
          }).then((syncPairs) => {
            return ParseStatus.mergeObjectSync(status, syncPairs);
          });
        } else {
          return ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get shape() {
        return this._def.shape();
      }
      strict(message) {
        errorUtil.errToObj;
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strict",
          ...message !== void 0 ? {
            errorMap: (issue, ctx) => {
              const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
              if (issue.code === "unrecognized_keys")
                return {
                  message: errorUtil.errToObj(message).message ?? defaultError
                };
              return {
                message: defaultError
              };
            }
          } : {}
        });
      }
      strip() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strip"
        });
      }
      passthrough() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "passthrough"
        });
      }
      // const AugmentFactory =
      //   <Def extends ZodObjectDef>(def: Def) =>
      //   <Augmentation extends ZodRawShape>(
      //     augmentation: Augmentation
      //   ): ZodObject<
      //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
      //     Def["unknownKeys"],
      //     Def["catchall"]
      //   > => {
      //     return new ZodObject({
      //       ...def,
      //       shape: () => ({
      //         ...def.shape(),
      //         ...augmentation,
      //       }),
      //     }) as any;
      //   };
      extend(augmentation) {
        return new _ZodObject({
          ...this._def,
          shape: () => ({
            ...this._def.shape(),
            ...augmentation
          })
        });
      }
      /**
       * Prior to zod@1.0.12 there was a bug in the
       * inferred type of merged objects. Please
       * upgrade if you are experiencing issues.
       */
      merge(merging) {
        const merged = new _ZodObject({
          unknownKeys: merging._def.unknownKeys,
          catchall: merging._def.catchall,
          shape: () => ({
            ...this._def.shape(),
            ...merging._def.shape()
          }),
          typeName: ZodFirstPartyTypeKind.ZodObject
        });
        return merged;
      }
      // merge<
      //   Incoming extends AnyZodObject,
      //   Augmentation extends Incoming["shape"],
      //   NewOutput extends {
      //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
      //       ? Augmentation[k]["_output"]
      //       : k extends keyof Output
      //       ? Output[k]
      //       : never;
      //   },
      //   NewInput extends {
      //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
      //       ? Augmentation[k]["_input"]
      //       : k extends keyof Input
      //       ? Input[k]
      //       : never;
      //   }
      // >(
      //   merging: Incoming
      // ): ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"],
      //   NewOutput,
      //   NewInput
      // > {
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      setKey(key, schema) {
        return this.augment({ [key]: schema });
      }
      // merge<Incoming extends AnyZodObject>(
      //   merging: Incoming
      // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
      // ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"]
      // > {
      //   // const mergedShape = objectUtil.mergeShapes(
      //   //   this._def.shape(),
      //   //   merging._def.shape()
      //   // );
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      catchall(index) {
        return new _ZodObject({
          ...this._def,
          catchall: index
        });
      }
      pick(mask) {
        const shape = {};
        for (const key of util.objectKeys(mask)) {
          if (mask[key] && this.shape[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      omit(mask) {
        const shape = {};
        for (const key of util.objectKeys(this.shape)) {
          if (!mask[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      /**
       * @deprecated
       */
      deepPartial() {
        return deepPartialify(this);
      }
      partial(mask) {
        const newShape = {};
        for (const key of util.objectKeys(this.shape)) {
          const fieldSchema = this.shape[key];
          if (mask && !mask[key]) {
            newShape[key] = fieldSchema;
          } else {
            newShape[key] = fieldSchema.optional();
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      required(mask) {
        const newShape = {};
        for (const key of util.objectKeys(this.shape)) {
          if (mask && !mask[key]) {
            newShape[key] = this.shape[key];
          } else {
            const fieldSchema = this.shape[key];
            let newField = fieldSchema;
            while (newField instanceof ZodOptional) {
              newField = newField._def.innerType;
            }
            newShape[key] = newField;
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      keyof() {
        return createZodEnum(util.objectKeys(this.shape));
      }
    };
    ZodObject.create = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.strictCreate = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strict",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.lazycreate = (shape, params) => {
      return new ZodObject({
        shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodUnion = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const options = this._def.options;
        function handleResults(results) {
          for (const result of results) {
            if (result.result.status === "valid") {
              return result.result;
            }
          }
          for (const result of results) {
            if (result.result.status === "dirty") {
              ctx.common.issues.push(...result.ctx.common.issues);
              return result.result;
            }
          }
          const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union,
            unionErrors
          });
          return INVALID;
        }
        if (ctx.common.async) {
          return Promise.all(options.map(async (option) => {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            return {
              result: await option._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: childCtx
              }),
              ctx: childCtx
            };
          })).then(handleResults);
        } else {
          let dirty = void 0;
          const issues = [];
          for (const option of options) {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            const result = option._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: childCtx
            });
            if (result.status === "valid") {
              return result;
            } else if (result.status === "dirty" && !dirty) {
              dirty = { result, ctx: childCtx };
            }
            if (childCtx.common.issues.length) {
              issues.push(childCtx.common.issues);
            }
          }
          if (dirty) {
            ctx.common.issues.push(...dirty.ctx.common.issues);
            return dirty.result;
          }
          const unionErrors = issues.map((issues2) => new ZodError(issues2));
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union,
            unionErrors
          });
          return INVALID;
        }
      }
      get options() {
        return this._def.options;
      }
    };
    ZodUnion.create = (types, params) => {
      return new ZodUnion({
        options: types,
        typeName: ZodFirstPartyTypeKind.ZodUnion,
        ...processCreateParams(params)
      });
    };
    getDiscriminator = (type) => {
      if (type instanceof ZodLazy) {
        return getDiscriminator(type.schema);
      } else if (type instanceof ZodEffects) {
        return getDiscriminator(type.innerType());
      } else if (type instanceof ZodLiteral) {
        return [type.value];
      } else if (type instanceof ZodEnum) {
        return type.options;
      } else if (type instanceof ZodNativeEnum) {
        return util.objectValues(type.enum);
      } else if (type instanceof ZodDefault) {
        return getDiscriminator(type._def.innerType);
      } else if (type instanceof ZodUndefined) {
        return [void 0];
      } else if (type instanceof ZodNull) {
        return [null];
      } else if (type instanceof ZodOptional) {
        return [void 0, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodNullable) {
        return [null, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodBranded) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodReadonly) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodCatch) {
        return getDiscriminator(type._def.innerType);
      } else {
        return [];
      }
    };
    ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const discriminator = this.discriminator;
        const discriminatorValue = ctx.data[discriminator];
        const option = this.optionsMap.get(discriminatorValue);
        if (!option) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union_discriminator,
            options: Array.from(this.optionsMap.keys()),
            path: [discriminator]
          });
          return INVALID;
        }
        if (ctx.common.async) {
          return option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        } else {
          return option._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        }
      }
      get discriminator() {
        return this._def.discriminator;
      }
      get options() {
        return this._def.options;
      }
      get optionsMap() {
        return this._def.optionsMap;
      }
      /**
       * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
       * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
       * have a different value for each object in the union.
       * @param discriminator the name of the discriminator property
       * @param types an array of object schemas
       * @param params
       */
      static create(discriminator, options, params) {
        const optionsMap = /* @__PURE__ */ new Map();
        for (const type of options) {
          const discriminatorValues = getDiscriminator(type.shape[discriminator]);
          if (!discriminatorValues.length) {
            throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
          }
          for (const value of discriminatorValues) {
            if (optionsMap.has(value)) {
              throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
            }
            optionsMap.set(value, type);
          }
        }
        return new _ZodDiscriminatedUnion({
          typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
          discriminator,
          options,
          optionsMap,
          ...processCreateParams(params)
        });
      }
    };
    ZodIntersection = class extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const handleParsed = (parsedLeft, parsedRight) => {
          if (isAborted(parsedLeft) || isAborted(parsedRight)) {
            return INVALID;
          }
          const merged = mergeValues(parsedLeft.value, parsedRight.value);
          if (!merged.valid) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_intersection_types
            });
            return INVALID;
          }
          if (isDirty(parsedLeft) || isDirty(parsedRight)) {
            status.dirty();
          }
          return { status: status.value, value: merged.data };
        };
        if (ctx.common.async) {
          return Promise.all([
            this._def.left._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            }),
            this._def.right._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            })
          ]).then(([left, right]) => handleParsed(left, right));
        } else {
          return handleParsed(this._def.left._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }), this._def.right._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }));
        }
      }
    };
    ZodIntersection.create = (left, right, params) => {
      return new ZodIntersection({
        left,
        right,
        typeName: ZodFirstPartyTypeKind.ZodIntersection,
        ...processCreateParams(params)
      });
    };
    ZodTuple = class _ZodTuple extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.array) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.array,
            received: ctx.parsedType
          });
          return INVALID;
        }
        if (ctx.data.length < this._def.items.length) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          return INVALID;
        }
        const rest = this._def.rest;
        if (!rest && ctx.data.length > this._def.items.length) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          status.dirty();
        }
        const items = [...ctx.data].map((item, itemIndex) => {
          const schema = this._def.items[itemIndex] || this._def.rest;
          if (!schema)
            return null;
          return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
        }).filter((x) => !!x);
        if (ctx.common.async) {
          return Promise.all(items).then((results) => {
            return ParseStatus.mergeArray(status, results);
          });
        } else {
          return ParseStatus.mergeArray(status, items);
        }
      }
      get items() {
        return this._def.items;
      }
      rest(rest) {
        return new _ZodTuple({
          ...this._def,
          rest
        });
      }
    };
    ZodTuple.create = (schemas, params) => {
      if (!Array.isArray(schemas)) {
        throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
      }
      return new ZodTuple({
        items: schemas,
        typeName: ZodFirstPartyTypeKind.ZodTuple,
        rest: null,
        ...processCreateParams(params)
      });
    };
    ZodRecord = class _ZodRecord extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const pairs = [];
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        for (const key in ctx.data) {
          pairs.push({
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
            value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (ctx.common.async) {
          return ParseStatus.mergeObjectAsync(status, pairs);
        } else {
          return ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get element() {
        return this._def.valueType;
      }
      static create(first, second, third) {
        if (second instanceof ZodType) {
          return new _ZodRecord({
            keyType: first,
            valueType: second,
            typeName: ZodFirstPartyTypeKind.ZodRecord,
            ...processCreateParams(third)
          });
        }
        return new _ZodRecord({
          keyType: ZodString.create(),
          valueType: first,
          typeName: ZodFirstPartyTypeKind.ZodRecord,
          ...processCreateParams(second)
        });
      }
    };
    ZodMap = class extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.map) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.map,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        const pairs = [...ctx.data.entries()].map(([key, value], index) => {
          return {
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
            value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
          };
        });
        if (ctx.common.async) {
          const finalMap = /* @__PURE__ */ new Map();
          return Promise.resolve().then(async () => {
            for (const pair of pairs) {
              const key = await pair.key;
              const value = await pair.value;
              if (key.status === "aborted" || value.status === "aborted") {
                return INVALID;
              }
              if (key.status === "dirty" || value.status === "dirty") {
                status.dirty();
              }
              finalMap.set(key.value, value.value);
            }
            return { status: status.value, value: finalMap };
          });
        } else {
          const finalMap = /* @__PURE__ */ new Map();
          for (const pair of pairs) {
            const key = pair.key;
            const value = pair.value;
            if (key.status === "aborted" || value.status === "aborted") {
              return INVALID;
            }
            if (key.status === "dirty" || value.status === "dirty") {
              status.dirty();
            }
            finalMap.set(key.value, value.value);
          }
          return { status: status.value, value: finalMap };
        }
      }
    };
    ZodMap.create = (keyType, valueType, params) => {
      return new ZodMap({
        valueType,
        keyType,
        typeName: ZodFirstPartyTypeKind.ZodMap,
        ...processCreateParams(params)
      });
    };
    ZodSet = class _ZodSet extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.set) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.set,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const def = this._def;
        if (def.minSize !== null) {
          if (ctx.data.size < def.minSize.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: def.minSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.minSize.message
            });
            status.dirty();
          }
        }
        if (def.maxSize !== null) {
          if (ctx.data.size > def.maxSize.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: def.maxSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.maxSize.message
            });
            status.dirty();
          }
        }
        const valueType = this._def.valueType;
        function finalizeSet(elements2) {
          const parsedSet = /* @__PURE__ */ new Set();
          for (const element of elements2) {
            if (element.status === "aborted")
              return INVALID;
            if (element.status === "dirty")
              status.dirty();
            parsedSet.add(element.value);
          }
          return { status: status.value, value: parsedSet };
        }
        const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
        if (ctx.common.async) {
          return Promise.all(elements).then((elements2) => finalizeSet(elements2));
        } else {
          return finalizeSet(elements);
        }
      }
      min(minSize, message) {
        return new _ZodSet({
          ...this._def,
          minSize: { value: minSize, message: errorUtil.toString(message) }
        });
      }
      max(maxSize, message) {
        return new _ZodSet({
          ...this._def,
          maxSize: { value: maxSize, message: errorUtil.toString(message) }
        });
      }
      size(size, message) {
        return this.min(size, message).max(size, message);
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    ZodSet.create = (valueType, params) => {
      return new ZodSet({
        valueType,
        minSize: null,
        maxSize: null,
        typeName: ZodFirstPartyTypeKind.ZodSet,
        ...processCreateParams(params)
      });
    };
    ZodFunction = class _ZodFunction extends ZodType {
      constructor() {
        super(...arguments);
        this.validate = this.implement;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.function) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.function,
            received: ctx.parsedType
          });
          return INVALID;
        }
        function makeArgsIssue(args, error) {
          return makeIssue({
            data: args,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
            issueData: {
              code: ZodIssueCode.invalid_arguments,
              argumentsError: error
            }
          });
        }
        function makeReturnsIssue(returns, error) {
          return makeIssue({
            data: returns,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
            issueData: {
              code: ZodIssueCode.invalid_return_type,
              returnTypeError: error
            }
          });
        }
        const params = { errorMap: ctx.common.contextualErrorMap };
        const fn = ctx.data;
        if (this._def.returns instanceof ZodPromise) {
          const me = this;
          return OK(async function(...args) {
            const error = new ZodError([]);
            const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
              error.addIssue(makeArgsIssue(args, e));
              throw error;
            });
            const result = await Reflect.apply(fn, this, parsedArgs);
            const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
              error.addIssue(makeReturnsIssue(result, e));
              throw error;
            });
            return parsedReturns;
          });
        } else {
          const me = this;
          return OK(function(...args) {
            const parsedArgs = me._def.args.safeParse(args, params);
            if (!parsedArgs.success) {
              throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
            }
            const result = Reflect.apply(fn, this, parsedArgs.data);
            const parsedReturns = me._def.returns.safeParse(result, params);
            if (!parsedReturns.success) {
              throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
            }
            return parsedReturns.data;
          });
        }
      }
      parameters() {
        return this._def.args;
      }
      returnType() {
        return this._def.returns;
      }
      args(...items) {
        return new _ZodFunction({
          ...this._def,
          args: ZodTuple.create(items).rest(ZodUnknown.create())
        });
      }
      returns(returnType) {
        return new _ZodFunction({
          ...this._def,
          returns: returnType
        });
      }
      implement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      strictImplement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      static create(args, returns, params) {
        return new _ZodFunction({
          args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
          returns: returns || ZodUnknown.create(),
          typeName: ZodFirstPartyTypeKind.ZodFunction,
          ...processCreateParams(params)
        });
      }
    };
    ZodLazy = class extends ZodType {
      get schema() {
        return this._def.getter();
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const lazySchema = this._def.getter();
        return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
      }
    };
    ZodLazy.create = (getter, params) => {
      return new ZodLazy({
        getter,
        typeName: ZodFirstPartyTypeKind.ZodLazy,
        ...processCreateParams(params)
      });
    };
    ZodLiteral = class extends ZodType {
      _parse(input) {
        if (input.data !== this._def.value) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_literal,
            expected: this._def.value
          });
          return INVALID;
        }
        return { status: "valid", value: input.data };
      }
      get value() {
        return this._def.value;
      }
    };
    ZodLiteral.create = (value, params) => {
      return new ZodLiteral({
        value,
        typeName: ZodFirstPartyTypeKind.ZodLiteral,
        ...processCreateParams(params)
      });
    };
    ZodEnum = class _ZodEnum extends ZodType {
      _parse(input) {
        if (typeof input.data !== "string") {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          addIssueToContext(ctx, {
            expected: util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodIssueCode.invalid_type
          });
          return INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(this._def.values);
        }
        if (!this._cache.has(input.data)) {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return INVALID;
        }
        return OK(input.data);
      }
      get options() {
        return this._def.values;
      }
      get enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Values() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      extract(values, newDef = this._def) {
        return _ZodEnum.create(values, {
          ...this._def,
          ...newDef
        });
      }
      exclude(values, newDef = this._def) {
        return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
          ...this._def,
          ...newDef
        });
      }
    };
    ZodEnum.create = createZodEnum;
    ZodNativeEnum = class extends ZodType {
      _parse(input) {
        const nativeEnumValues = util.getValidEnumValues(this._def.values);
        const ctx = this._getOrReturnCtx(input);
        if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
          const expectedValues = util.objectValues(nativeEnumValues);
          addIssueToContext(ctx, {
            expected: util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodIssueCode.invalid_type
          });
          return INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(util.getValidEnumValues(this._def.values));
        }
        if (!this._cache.has(input.data)) {
          const expectedValues = util.objectValues(nativeEnumValues);
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return INVALID;
        }
        return OK(input.data);
      }
      get enum() {
        return this._def.values;
      }
    };
    ZodNativeEnum.create = (values, params) => {
      return new ZodNativeEnum({
        values,
        typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
        ...processCreateParams(params)
      });
    };
    ZodPromise = class extends ZodType {
      unwrap() {
        return this._def.type;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.promise,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
        return OK(promisified.then((data) => {
          return this._def.type.parseAsync(data, {
            path: ctx.path,
            errorMap: ctx.common.contextualErrorMap
          });
        }));
      }
    };
    ZodPromise.create = (schema, params) => {
      return new ZodPromise({
        type: schema,
        typeName: ZodFirstPartyTypeKind.ZodPromise,
        ...processCreateParams(params)
      });
    };
    ZodEffects = class extends ZodType {
      innerType() {
        return this._def.schema;
      }
      sourceType() {
        return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const effect = this._def.effect || null;
        const checkCtx = {
          addIssue: (arg) => {
            addIssueToContext(ctx, arg);
            if (arg.fatal) {
              status.abort();
            } else {
              status.dirty();
            }
          },
          get path() {
            return ctx.path;
          }
        };
        checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
        if (effect.type === "preprocess") {
          const processed = effect.transform(ctx.data, checkCtx);
          if (ctx.common.async) {
            return Promise.resolve(processed).then(async (processed2) => {
              if (status.value === "aborted")
                return INVALID;
              const result = await this._def.schema._parseAsync({
                data: processed2,
                path: ctx.path,
                parent: ctx
              });
              if (result.status === "aborted")
                return INVALID;
              if (result.status === "dirty")
                return DIRTY(result.value);
              if (status.value === "dirty")
                return DIRTY(result.value);
              return result;
            });
          } else {
            if (status.value === "aborted")
              return INVALID;
            const result = this._def.schema._parseSync({
              data: processed,
              path: ctx.path,
              parent: ctx
            });
            if (result.status === "aborted")
              return INVALID;
            if (result.status === "dirty")
              return DIRTY(result.value);
            if (status.value === "dirty")
              return DIRTY(result.value);
            return result;
          }
        }
        if (effect.type === "refinement") {
          const executeRefinement = (acc) => {
            const result = effect.refinement(acc, checkCtx);
            if (ctx.common.async) {
              return Promise.resolve(result);
            }
            if (result instanceof Promise) {
              throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
            }
            return acc;
          };
          if (ctx.common.async === false) {
            const inner = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inner.status === "aborted")
              return INVALID;
            if (inner.status === "dirty")
              status.dirty();
            executeRefinement(inner.value);
            return { status: status.value, value: inner.value };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
              if (inner.status === "aborted")
                return INVALID;
              if (inner.status === "dirty")
                status.dirty();
              return executeRefinement(inner.value).then(() => {
                return { status: status.value, value: inner.value };
              });
            });
          }
        }
        if (effect.type === "transform") {
          if (ctx.common.async === false) {
            const base = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (!isValid(base))
              return INVALID;
            const result = effect.transform(base.value, checkCtx);
            if (result instanceof Promise) {
              throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
            }
            return { status: status.value, value: result };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
              if (!isValid(base))
                return INVALID;
              return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
                status: status.value,
                value: result
              }));
            });
          }
        }
        util.assertNever(effect);
      }
    };
    ZodEffects.create = (schema, effect, params) => {
      return new ZodEffects({
        schema,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect,
        ...processCreateParams(params)
      });
    };
    ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
      return new ZodEffects({
        schema,
        effect: { type: "preprocess", transform: preprocess },
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        ...processCreateParams(params)
      });
    };
    ZodOptional = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.undefined) {
          return OK(void 0);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodOptional.create = (type, params) => {
      return new ZodOptional({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodOptional,
        ...processCreateParams(params)
      });
    };
    ZodNullable = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.null) {
          return OK(null);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodNullable.create = (type, params) => {
      return new ZodNullable({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodNullable,
        ...processCreateParams(params)
      });
    };
    ZodDefault = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        let data = ctx.data;
        if (ctx.parsedType === ZodParsedType.undefined) {
          data = this._def.defaultValue();
        }
        return this._def.innerType._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      removeDefault() {
        return this._def.innerType;
      }
    };
    ZodDefault.create = (type, params) => {
      return new ZodDefault({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodDefault,
        defaultValue: typeof params.default === "function" ? params.default : () => params.default,
        ...processCreateParams(params)
      });
    };
    ZodCatch = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const newCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          }
        };
        const result = this._def.innerType._parse({
          data: newCtx.data,
          path: newCtx.path,
          parent: {
            ...newCtx
          }
        });
        if (isAsync(result)) {
          return result.then((result2) => {
            return {
              status: "valid",
              value: result2.status === "valid" ? result2.value : this._def.catchValue({
                get error() {
                  return new ZodError(newCtx.common.issues);
                },
                input: newCtx.data
              })
            };
          });
        } else {
          return {
            status: "valid",
            value: result.status === "valid" ? result.value : this._def.catchValue({
              get error() {
                return new ZodError(newCtx.common.issues);
              },
              input: newCtx.data
            })
          };
        }
      }
      removeCatch() {
        return this._def.innerType;
      }
    };
    ZodCatch.create = (type, params) => {
      return new ZodCatch({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodCatch,
        catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
        ...processCreateParams(params)
      });
    };
    ZodNaN = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.nan) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.nan,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return { status: "valid", value: input.data };
      }
    };
    ZodNaN.create = (params) => {
      return new ZodNaN({
        typeName: ZodFirstPartyTypeKind.ZodNaN,
        ...processCreateParams(params)
      });
    };
    BRAND = /* @__PURE__ */ Symbol("zod_brand");
    ZodBranded = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const data = ctx.data;
        return this._def.type._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      unwrap() {
        return this._def.type;
      }
    };
    ZodPipeline = class _ZodPipeline extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.common.async) {
          const handleAsync = async () => {
            const inResult = await this._def.in._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inResult.status === "aborted")
              return INVALID;
            if (inResult.status === "dirty") {
              status.dirty();
              return DIRTY(inResult.value);
            } else {
              return this._def.out._parseAsync({
                data: inResult.value,
                path: ctx.path,
                parent: ctx
              });
            }
          };
          return handleAsync();
        } else {
          const inResult = this._def.in._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inResult.status === "aborted")
            return INVALID;
          if (inResult.status === "dirty") {
            status.dirty();
            return {
              status: "dirty",
              value: inResult.value
            };
          } else {
            return this._def.out._parseSync({
              data: inResult.value,
              path: ctx.path,
              parent: ctx
            });
          }
        }
      }
      static create(a, b) {
        return new _ZodPipeline({
          in: a,
          out: b,
          typeName: ZodFirstPartyTypeKind.ZodPipeline
        });
      }
    };
    ZodReadonly = class extends ZodType {
      _parse(input) {
        const result = this._def.innerType._parse(input);
        const freeze = (data) => {
          if (isValid(data)) {
            data.value = Object.freeze(data.value);
          }
          return data;
        };
        return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodReadonly.create = (type, params) => {
      return new ZodReadonly({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodReadonly,
        ...processCreateParams(params)
      });
    };
    late = {
      object: ZodObject.lazycreate
    };
    (function(ZodFirstPartyTypeKind2) {
      ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
      ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
      ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
      ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
      ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
      ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
      ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
      ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
      ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
      ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
      ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
      ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
      ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
      ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
      ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
      ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
      ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
      ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
      ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
      ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
      ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
      ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
      ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
      ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
      ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
      ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
      ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
      ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
      ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
      ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
      ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
      ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
      ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
      ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
      ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
      ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
    })(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
    instanceOfType = (cls, params = {
      message: `Input not instance of ${cls.name}`
    }) => custom((data) => data instanceof cls, params);
    stringType = ZodString.create;
    numberType = ZodNumber.create;
    nanType = ZodNaN.create;
    bigIntType = ZodBigInt.create;
    booleanType = ZodBoolean.create;
    dateType = ZodDate.create;
    symbolType = ZodSymbol.create;
    undefinedType = ZodUndefined.create;
    nullType = ZodNull.create;
    anyType = ZodAny.create;
    unknownType = ZodUnknown.create;
    neverType = ZodNever.create;
    voidType = ZodVoid.create;
    arrayType = ZodArray.create;
    objectType = ZodObject.create;
    strictObjectType = ZodObject.strictCreate;
    unionType = ZodUnion.create;
    discriminatedUnionType = ZodDiscriminatedUnion.create;
    intersectionType = ZodIntersection.create;
    tupleType = ZodTuple.create;
    recordType = ZodRecord.create;
    mapType = ZodMap.create;
    setType = ZodSet.create;
    functionType = ZodFunction.create;
    lazyType = ZodLazy.create;
    literalType = ZodLiteral.create;
    enumType = ZodEnum.create;
    nativeEnumType = ZodNativeEnum.create;
    promiseType = ZodPromise.create;
    effectsType = ZodEffects.create;
    optionalType = ZodOptional.create;
    nullableType = ZodNullable.create;
    preprocessType = ZodEffects.createWithPreprocess;
    pipelineType = ZodPipeline.create;
    ostring = () => stringType().optional();
    onumber = () => numberType().optional();
    oboolean = () => booleanType().optional();
    coerce = {
      string: ((arg) => ZodString.create({ ...arg, coerce: true })),
      number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
      boolean: ((arg) => ZodBoolean.create({
        ...arg,
        coerce: true
      })),
      bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
      date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
    };
    NEVER = INVALID;
  }
});

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});
var init_external = __esm({
  "node_modules/zod/v3/external.js"() {
    init_errors();
    init_parseUtil();
    init_typeAliases();
    init_util();
    init_types();
    init_ZodError();
  }
});

// node_modules/zod/index.js
var init_zod = __esm({
  "node_modules/zod/index.js"() {
    init_external();
    init_external();
  }
});

// src/config/schema.js
var DomainSchema, SyncSchema, ConfigSchema;
var init_schema2 = __esm({
  "src/config/schema.js"() {
    "use strict";
    init_zod();
    DomainSchema = external_exports.object({
      name: external_exports.string(),
      entityHints: external_exports.array(external_exports.string()).default([]),
      relationHints: external_exports.array(external_exports.string()).default([])
    });
    SyncSchema = external_exports.object({
      memoryMd: external_exports.string().nullable().default(null),
      neuralMemory: external_exports.string().nullable().default(null),
      importOnStart: external_exports.boolean().default(false)
    });
    ConfigSchema = external_exports.object({
      storage: external_exports.object({
        path: external_exports.string().default("./memory-graph.db"),
        maxSizeMb: external_exports.number().default(500)
      }).default({}),
      extraction: external_exports.object({
        provider: external_exports.enum(["auto", "openai", "anthropic", "ollama"]).default("auto"),
        model: external_exports.string().default("auto"),
        autoExtract: external_exports.boolean().default(true),
        minConfidence: external_exports.number().min(0).max(1).default(0.7),
        batchSize: external_exports.number().default(5)
      }).default({}),
      domains: external_exports.array(DomainSchema).default([]),
      deduplication: external_exports.object({
        enabled: external_exports.boolean().default(true),
        similarityThreshold: external_exports.number().min(0).max(1).default(0.85)
      }).default({}),
      sync: SyncSchema.default({}),
      query: external_exports.object({
        maxHops: external_exports.number().default(5),
        maxResults: external_exports.number().default(50),
        includeConfidence: external_exports.boolean().default(true)
      }).default({})
    });
  }
});

// src/config/defaults.js
import { readFileSync, existsSync } from "node:fs";
import { resolve as resolve2 } from "node:path";
function loadConfig(configPath) {
  const paths = configPath ? [configPath] : [
    resolve2(process.cwd(), "config", CONFIG_FILENAME),
    resolve2(process.cwd(), CONFIG_FILENAME)
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        return ConfigSchema.parse(raw);
      } catch (err) {
        console.warn(`[agent-memory-graph] Invalid config at ${p}, using defaults.`);
      }
    }
  }
  return ConfigSchema.parse({});
}
var CONFIG_FILENAME;
var init_defaults = __esm({
  "src/config/defaults.js"() {
    "use strict";
    init_schema2();
    CONFIG_FILENAME = "graph.config.json";
  }
});

// src/extract/extractor.js
function buildPrompt(text, domains) {
  const domainContext = domains.length > 0 ? `
Domain hints (use these to improve accuracy):
${domains.map(
    (d) => `- ${d.name}: entities=[${d.entityHints.join(", ")}], relations=[${d.relationHints.join(", ")}]`
  ).join("\n")}
` : "";
  return `You are an entity and relationship extractor. Given text, extract all meaningful entities and their relationships.

Rules:
1. Extract entities with their most specific type (Person, Project, Tool, Company, Location, Concept, etc.)
2. Extract directional relationships between entities (FROM -[RELATION]-> TO)
3. Be domain-agnostic \u2014 work with any topic
4. Assign confidence scores (0.0 to 1.0) based on how explicit the mention is
5. Resolve pronouns to their referents when clearly determinable
6. Do NOT hallucinate entities not mentioned or strongly implied in the text
7. Normalize entity names (capitalize properly, use full names when available)
8. Use UPPER_SNAKE_CASE for relationship types (WORKS_ON, USES, OWNS, etc.)
9. Extract temporal context when mentioned (dates, timeframes, "last year", "in 2024", "recently"). Store as properties: {"when": "2024", "temporal": "joined in 2024"}
10. For relationships with time context, include a "when" property: {"from": "X", "relation": "JOINED", "to": "Y", "when": "2024"}
11. Do NOT extract tokens, API keys, passwords, hashes, or secrets as entities
12. Do NOT extract CLI commands (/new, /reset, /status) as entities
${domainContext}
Return ONLY valid JSON (no markdown, no explanation):
{
  "entities": [
    {"name": "Entity Name", "type": "Type", "properties": {"role": "CTO", "when": "2024"}, "confidence": 0.9}
  ],
  "relationships": [
    {"from": "Entity A", "relation": "RELATION_TYPE", "to": "Entity B", "fromType": "TypeA", "toType": "TypeB", "confidence": 0.85, "when": "optional temporal context"}
  ]
}

If the text contains no meaningful entities or relationships, return:
{"entities": [], "relationships": []}

Text to extract from:
"""
${text}
"""`;
}
function detectProvider(config) {
  if (config.extraction.provider !== "auto") {
    return config.extraction.provider;
  }
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OLLAMA_HOST || process.env.OLLAMA_URL) return "ollama";
  return null;
}
async function callOpenAI(prompt, model) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "sk-local",
    baseURL: process.env.OPENAI_BASE_URL || "http://127.0.0.1:20128/v1"
  });
  const response = await client.chat.completions.create({
    model: model === "auto" ? "gpt-4o-mini" : model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    response_format: { type: "json_object" }
  });
  return response.choices[0]?.message?.content ?? '{"entities":[],"relationships":[]}';
}
async function callAnthropic(prompt, model) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: model === "auto" ? "claude-3-5-haiku-20241022" : model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }]
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : '{"entities":[],"relationships":[]}';
}
async function callOllama(prompt, model) {
  const host = process.env.OLLAMA_HOST || process.env.OLLAMA_URL || "http://localhost:11434";
  const response = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model === "auto" ? "llama3.1" : model,
      prompt,
      stream: false,
      format: "json"
    })
  });
  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.response;
}
async function extractFromText(text, config) {
  const provider = detectProvider(config);
  if (!provider) {
    throw new Error(
      "No LLM provider available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_HOST."
    );
  }
  const prompt = buildPrompt(text, config.domains);
  const model = config.extraction.model;
  let rawResponse;
  switch (provider) {
    case "openai":
      rawResponse = await callOpenAI(prompt, model);
      break;
    case "anthropic":
      rawResponse = await callAnthropic(prompt, model);
      break;
    case "ollama":
      rawResponse = await callOllama(prompt, model);
      break;
  }
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { entities: [], relationships: [] };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const entities = (parsed.entities || []).filter((e) => e.name && e.type && (e.confidence ?? 1) >= config.extraction.minConfidence).map((e) => ({
      name: String(e.name).trim(),
      type: String(e.type).trim(),
      properties: e.properties ?? {},
      confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.8))
    }));
    const relationships = (parsed.relationships || []).filter((r) => r.from && r.relation && r.to && (r.confidence ?? 1) >= config.extraction.minConfidence).map((r) => ({
      from: String(r.from).trim(),
      relation: String(r.relation).trim().toUpperCase().replace(/\s+/g, "_"),
      to: String(r.to).trim(),
      fromType: r.fromType?.trim(),
      toType: r.toType?.trim(),
      confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0.8)),
      when: r.when ? String(r.when).trim() : void 0
    }));
    return { entities, relationships };
  } catch (err) {
    console.warn("[agent-memory-graph] Failed to parse extraction response:", err);
    return { entities: [], relationships: [] };
  }
}
var init_extractor = __esm({
  "src/extract/extractor.js"() {
    "use strict";
  }
});

// src/search/hybrid.js
function hybridSearch(engine, query, config) {
  const limit = config.query.maxResults;
  const entities = engine.searchEntities(query, limit);
  const results = entities.map((entity) => {
    const outgoing = engine.getRelationsFrom(entity.id);
    const incoming = engine.getRelationsTo(entity.id);
    const relations = [
      ...outgoing.map((r) => ({
        direction: "outgoing",
        relation: r.relation,
        target: r.to_name,
        targetType: r.to_type
      })),
      ...incoming.map((r) => ({
        direction: "incoming",
        relation: r.relation,
        target: r.from_name,
        targetType: r.from_type
      }))
    ];
    return {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        properties: entity.properties
      },
      relations
    };
  });
  return results;
}
var init_hybrid = __esm({
  "src/search/hybrid.js"() {
    "use strict";
  }
});

// src/search/natural-language.js
async function naturalLanguageQuery(question, engine, config) {
  const q = question.toLowerCase().trim();
  const whereDidMatch = q.match(/where (?:did|does|has) (.+?) (?:work|come from|work before|previously work|used to work)/);
  if (whereDidMatch) {
    return queryEntityRelations(engine, whereDidMatch[1].trim(), ["WORKED_AT", "PREVIOUSLY_WORKED_AT", "CAME_FROM"], config);
  }
  const roleMatch = q.match(/what (?:is|are) (.+?)(?:'s|s') (?:role|position|title|job)/);
  if (roleMatch) {
    return queryEntityProperties(engine, roleMatch[1].trim(), ["role", "position", "title"], config);
  }
  const roleMatch2 = q.match(/what (?:role|position|title) (?:does|did|is) (.+?) (?:have|hold|play)/);
  if (roleMatch2) {
    return queryEntityProperties(engine, roleMatch2[1].trim(), ["role", "position", "title"], config);
  }
  const whoWorksAtMatch = q.match(/who (?:works|is|are|worked) (?:at|for|in) (.+?)(?:\?|$)/);
  if (whoWorksAtMatch) {
    return queryWhoAtEntity(engine, whoWorksAtMatch[1].trim(), config);
  }
  const whoPossessiveMatch = q.match(/who (?:are|is|were) (.+?)(?:'s|s') (\w+)(?:\?|$)/);
  if (whoPossessiveMatch) {
    return queryAboutEntity(engine, whoPossessiveMatch[1].trim(), config);
  }
  const whoVerbMatch = q.match(/who (\w+(?:ed|s|es)?) (.+?)(?:\?|$)/);
  if (whoVerbMatch) {
    return queryWhoDidEntity(engine, whoVerbMatch[1], whoVerbMatch[2].trim(), config);
  }
  const workingOnMatch = q.match(/what (?:am i|do i|are we) (\w+(?:\s+\w+)*?)(?:\?|$)/);
  if (workingOnMatch) {
    return queryByRelationPattern(engine, workingOnMatch[1], config);
  }
  const connectionMatch = q.match(/(?:how is|connection between|relationship between|path from) (.+?) (?:connected to|and|to) (.+?)(?:\?|$)/);
  if (connectionMatch) {
    return queryConnection(engine, connectionMatch[1].trim(), connectionMatch[2].trim(), config);
  }
  const whatDoesMatch = q.match(/what (?:does|did|is|are|has) (.+?) (?:work on|use|own|manage|maintain|know|do|build|create|handle|work|run|have|lead|suggest)/);
  if (whatDoesMatch) {
    return queryAboutEntity(engine, whatDoesMatch[1].trim(), config);
  }
  const whatNounMatch = q.match(/what (\w+)s? (?:does|did|do|is|are|has) (.+?) (?:use|own|work on|manage|know|have|build|run|lead|need)/);
  if (whatNounMatch) {
    return queryAboutEntity(engine, whatNounMatch[2].trim(), config);
  }
  const whatIsVerbingMatch = q.match(/what ([\w\s]+?) (?:is|are) (.+?) (\w+ing)(?: on| with| at| for)?(?:\?|$)/);
  if (whatIsVerbingMatch) {
    const entityCandidate = whatIsVerbingMatch[2].trim();
    if (entityCandidate && !entityCandidate.match(/^\w+ing$/)) {
      return queryAboutEntity(engine, entityCandidate, config);
    }
  }
  const listMatch = q.match(/(?:list|show|get|find) (?:all |my |every )?(\w+)s?(?:\?|$)/);
  if (listMatch) {
    return queryListType(engine, listMatch[1], config);
  }
  const whatTypeMentioned = q.match(/what (\w+)s? (?:are|were|is) (?:mentioned|used|listed|included|involved)/);
  if (whatTypeMentioned) {
    return queryListType(engine, whatTypeMentioned[1], config);
  }
  const aboutMatch = q.match(/(?:tell me about|what is|who is|describe|info on|about) (.+?)(?:\?|$)/);
  if (aboutMatch) {
    return queryAboutEntity(engine, aboutMatch[1].trim(), config);
  }
  const possessiveMatch = q.match(/([\w\s]+?)(?:'s|s') ([\w\s]+?)(?:\?|$)/);
  if (possessiveMatch) {
    return queryAboutEntity(engine, possessiveMatch[1].trim(), config);
  }
  return querySmartFallback(engine, question, config);
}
async function queryEntityRelations(engine, entityName, relationTypes, config) {
  let entity = engine.findEntityByName(entityName);
  if (!entity) {
    const results = engine.searchEntities(entityName, 1);
    if (results.length === 0) {
      return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
    }
    entity = results[0];
  }
  const outgoing = engine.getRelationsFrom(entity.id);
  const incoming = engine.getRelationsTo(entity.id);
  const matchedOut = outgoing.filter(
    (r) => relationTypes.some((rt) => r.relation.toUpperCase().includes(rt.toUpperCase()))
  );
  const matchedIn = incoming.filter(
    (r) => relationTypes.some((rt) => r.relation.toUpperCase().includes(rt.toUpperCase()))
  );
  if (matchedOut.length > 0 || matchedIn.length > 0) {
    const parts = [];
    if (matchedOut.length > 0) parts.push(matchedOut.map((r) => `${r.relation} \u2192 ${r.to_name}`).join(", "));
    if (matchedIn.length > 0) parts.push(matchedIn.map((r) => `${r.from_name} \u2192 ${r.relation}`).join(", "));
    return {
      answer: `${entity.name}: ${parts.join("; ")}`,
      entities: [...matchedOut.map((r) => ({ name: r.to_name, type: r.to_type })), ...matchedIn.map((r) => ({ name: r.from_name, type: r.from_type }))],
      confidence: 0.85
    };
  }
  return queryAboutEntity(engine, entity.name, config);
}
async function queryEntityProperties(engine, entityName, propertyKeys, config) {
  let entity = engine.findEntityByName(entityName);
  if (!entity) {
    const results = engine.searchEntities(entityName, 1);
    if (results.length === 0) {
      return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
    }
    entity = results[0];
  }
  const props = entity.properties || {};
  const matchedProps = propertyKeys.filter((k) => props[k]).map((k) => `${k}: ${props[k]}`);
  if (matchedProps.length > 0) {
    return {
      answer: `${entity.name}: ${matchedProps.join(", ")}`,
      entities: [{ name: entity.name, type: entity.type }],
      confidence: 0.9
    };
  }
  const outgoing = engine.getRelationsFrom(entity.id);
  const roleRelations = outgoing.filter(
    (r) => ["LEADS", "MANAGES", "HEADS", "WORKS_AS", "ROLE_IS"].includes(r.relation.toUpperCase())
  );
  if (roleRelations.length > 0) {
    return {
      answer: `${entity.name}: ${roleRelations.map((r) => `${r.relation} \u2192 ${r.to_name}`).join(", ")}`,
      entities: [{ name: entity.name, type: entity.type }],
      confidence: 0.85
    };
  }
  return queryAboutEntity(engine, entity.name, config);
}
async function queryWhoAtEntity(engine, entityName, config) {
  let entity = engine.findEntityByName(entityName);
  if (!entity) {
    const results = engine.searchEntities(entityName, 1);
    if (results.length === 0) {
      return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
    }
    entity = results[0];
  }
  const incoming = engine.getRelationsTo(entity.id);
  const workers = incoming.filter((r) => ["WORKS_AT", "EMPLOYED_BY", "MEMBER_OF", "BELONGS_TO", "WORKS_FOR", "HIRED_BY"].includes(r.relation.toUpperCase())).map((r) => ({ name: r.from_name, type: r.from_type, relation: r.relation }));
  const outgoing = engine.getRelationsFrom(entity.id);
  const employed = outgoing.filter((r) => ["EMPLOYS", "HIRED", "HAS_MEMBER", "HAS_EMPLOYEE"].includes(r.relation.toUpperCase())).map((r) => ({ name: r.to_name, type: r.to_type, relation: r.relation }));
  const all = [...workers, ...employed];
  if (all.length > 0) {
    return {
      answer: `People at ${entity.name}: ${all.map((p) => p.name).join(", ")}`,
      entities: all.map((p) => ({ name: p.name, type: p.type })),
      confidence: 0.85
    };
  }
  const incomingPeople = incoming.filter((r) => r.from_type?.toLowerCase() === "person").map((r) => ({ name: r.from_name, type: r.from_type }));
  const outgoingPeople = outgoing.filter((r) => r.to_type?.toLowerCase() === "person").map((r) => ({ name: r.to_name, type: r.to_type }));
  const allConnected = [...incomingPeople, ...outgoingPeople];
  const unique = [...new Map(allConnected.map((r) => [r.name, r])).values()];
  if (unique.length > 0) {
    return {
      answer: `People connected to ${entity.name}: ${unique.map((p) => p.name).join(", ")}`,
      entities: unique,
      confidence: 0.75
    };
  }
  return { answer: `No people found at "${entityName}".`, entities: [], confidence: 0.3 };
}
async function queryWhoDidEntity(engine, verb, entityName, config) {
  let entity = engine.findEntityByName(entityName);
  if (!entity) {
    const results = engine.searchEntities(entityName, 1);
    if (results.length === 0) {
      return querySmartFallback(engine, `who ${verb} ${entityName}`, config);
    }
    entity = results[0];
  }
  const verbRoot = verb.replace(/ed$|s$|es$|ing$/, "").toUpperCase();
  const verbVariants = [verbRoot, `${verbRoot}S`, `${verbRoot}ED`, `${verbRoot}ES`];
  const incoming = engine.getRelationsTo(entity.id);
  const matched = incoming.filter((r) => {
    const rel = r.relation.toUpperCase();
    return verbVariants.some((v) => rel.includes(v)) || rel.includes(verbRoot);
  });
  if (matched.length > 0) {
    return {
      answer: `${matched.map((r) => `${r.from_name} ${r.relation} ${entity.name}`).join(", ")}`,
      entities: matched.map((r) => ({ name: r.from_name, type: r.from_type })),
      confidence: 0.85
    };
  }
  if (incoming.length > 0) {
    const people = incoming.filter((r) => r.from_type?.toLowerCase() === "person");
    if (people.length > 0) {
      return {
        answer: `People connected to ${entity.name}: ${people.map((r) => `${r.from_name} (${r.relation})`).join(", ")}`,
        entities: people.map((r) => ({ name: r.from_name, type: r.from_type })),
        confidence: 0.7
      };
    }
  }
  return queryAboutEntity(engine, entity.name, config);
}
async function querySmartFallback(engine, question, config) {
  const allEntities = engine.listEntities({ limit: 500 });
  if (allEntities.length === 0) {
    return { answer: "Graph is empty. Ingest some data first.", entities: [], confidence: 0.2 };
  }
  const qLower = question.toLowerCase();
  const mentioned = allEntities.filter((e) => qLower.includes(e.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length);
  if (mentioned.length > 0) {
    return queryAboutEntity(engine, mentioned[0].name, config);
  }
  const stopWords = /* @__PURE__ */ new Set(["what", "who", "where", "when", "how", "why", "does", "did", "the", "are", "is", "was", "were", "has", "have", "had", "all", "any", "some", "this", "that", "which", "there", "their", "about", "from", "with", "for", "and", "but", "not", "can", "will", "would", "should", "could", "been", "being", "mentioned", "used", "listed"]);
  const words = question.replace(/[?!.,;:'"]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()));
  for (const word of words) {
    const results = engine.searchEntities(word, 3);
    if (results.length > 0) {
      return queryAboutEntity(engine, results[0].name, config);
    }
  }
  return { answer: `No relevant entities found for: "${question}"`, entities: [], confidence: 0.2 };
}
async function queryByRelationPattern(engine, relationHint, config) {
  const relationMap = {
    "working on": ["WORKS_ON", "CONTRIBUTES_TO", "MAINTAINS"],
    "using": ["USES", "DEPENDS_ON"],
    "own": ["OWNS", "CREATED"],
    "managing": ["MANAGES", "LEADS"],
    "learning": ["LEARNING", "STUDIES"],
    "holding": ["HOLDS", "OWNS"],
    "mining": ["MINES"],
    "building": ["BUILDS", "CREATES"]
  };
  const matchedRelations = Object.entries(relationMap).filter(([phrase]) => relationHint.includes(phrase)).flatMap(([, rels]) => rels);
  const selfEntities = engine.searchEntities("self user me", 5).filter((e) => e.type.toLowerCase() === "person");
  const results = [];
  for (const self of selfEntities) {
    const rels = engine.getRelationsFrom(self.id);
    for (const rel of rels) {
      if (matchedRelations.length === 0 || matchedRelations.includes(rel.relation)) {
        results.push({ name: rel.to_name, type: rel.to_type });
      }
    }
  }
  const unique = [...new Map(results.map((r) => [r.name, r])).values()];
  return {
    answer: unique.length > 0 ? `Found ${unique.length} result(s): ${unique.map((r) => `${r.name} (${r.type})`).join(", ")}` : "No matching relationships found in the graph.",
    entities: unique,
    confidence: unique.length > 0 ? 0.8 : 0.3
  };
}
async function queryConnection(engine, fromName, toName, config) {
  const path = engine.findPath(fromName, toName, config.query.maxHops);
  if (!path) {
    return {
      answer: `No connection found between "${fromName}" and "${toName}" within ${config.query.maxHops} hops.`,
      entities: [],
      confidence: 0.5
    };
  }
  const pathStr = path.path.map((node, i) => i < path.relations.length ? `${node} ->[${path.relations[i]}]` : node).join(" ");
  return {
    answer: `Path: ${pathStr}`,
    entities: path.path.map((name) => ({ name, type: "Unknown" })),
    paths: [path],
    confidence: 0.9
  };
}
async function queryListType(engine, typeName, config) {
  const typeNormMap = {
    "people": "person",
    "persons": "person",
    "companies": "company",
    "organizations": "organization",
    "organisations": "organization",
    "tools": "tool",
    "projects": "project",
    "languages": "language",
    "programming languages": "language",
    "databases": "database",
    "services": "service",
    "teams": "team",
    "technologies": "technology"
  };
  const normalized = typeNormMap[typeName.toLowerCase()] || typeName;
  const variations = [
    normalized,
    normalized.charAt(0).toUpperCase() + normalized.slice(1),
    normalized.toUpperCase(),
    normalized.toLowerCase(),
    // Also try without trailing 's'
    normalized.endsWith("s") ? normalized.slice(0, -1) : normalized,
    normalized.endsWith("s") ? normalized.slice(0, -1).charAt(0).toUpperCase() + normalized.slice(0, -1).slice(1) : normalized.charAt(0).toUpperCase() + normalized.slice(1)
  ];
  for (const v of [...new Set(variations)]) {
    const found = engine.listEntities({ type: v, limit: config.query.maxResults });
    if (found.length > 0) {
      return {
        answer: `Found ${found.length} ${typeName}(s): ${found.map((e) => e.name).join(", ")}`,
        entities: found.map((e) => ({ name: e.name, type: e.type })),
        confidence: 0.85
      };
    }
  }
  const searchResults = engine.searchEntities(typeName, config.query.maxResults);
  if (searchResults.length > 0) {
    return {
      answer: `Found ${searchResults.length} result(s) for "${typeName}": ${searchResults.map((e) => `${e.name} (${e.type})`).join(", ")}`,
      entities: searchResults.map((e) => ({ name: e.name, type: e.type })),
      confidence: 0.7
    };
  }
  return {
    answer: `No entities of type "${typeName}" found.`,
    entities: [],
    confidence: 0.3
  };
}
async function queryAboutEntity(engine, entityName, config) {
  let entity = engine.findEntityByName(entityName);
  if (!entity) {
    const results = engine.searchEntities(entityName, 1);
    if (results.length === 0) {
      return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
    }
    entity = results[0];
  }
  const outgoing = engine.getRelationsFrom(entity.id);
  const incoming = engine.getRelationsTo(entity.id);
  const lines = [
    `${entity.name} (${entity.type})${entity.mention_count && entity.mention_count > 1 ? ` [mentions: ${entity.mention_count}]` : ""}`
  ];
  if (Object.keys(entity.properties).length > 0) {
    lines.push(`Properties: ${JSON.stringify(entity.properties)}`);
  }
  if (outgoing.length > 0) {
    lines.push(`Outgoing: ${outgoing.map((r) => `${r.relation} \u2192 ${r.to_name}`).join(", ")}`);
  }
  if (incoming.length > 0) {
    lines.push(`Incoming: ${incoming.map((r) => `${r.from_name} \u2192 ${r.relation}`).join(", ")}`);
  }
  return {
    answer: lines.join("\n"),
    entities: [
      { name: entity.name, type: entity.type },
      ...outgoing.map((r) => ({ name: r.to_name, type: r.to_type })),
      ...incoming.map((r) => ({ name: r.from_name, type: r.from_type }))
    ],
    confidence: 0.9
  };
}
var init_natural_language = __esm({
  "src/search/natural-language.js"() {
    "use strict";
  }
});

// src/sync/export.js
function exportGraph(engine, options) {
  const { format, includeProperties = false, maxEntities = 500 } = options;
  const entities = engine.listEntities({ limit: maxEntities });
  const stats = engine.stats();
  switch (format) {
    case "json":
      return exportJSON(engine, entities, includeProperties);
    case "mermaid":
      return exportMermaid(engine, entities);
    case "dot":
      return exportDOT(engine, entities);
    case "csv":
      return exportCSV(engine, entities);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
function exportJSON(engine, entities, includeProperties) {
  const nodes = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    ...includeProperties ? { properties: e.properties } : {},
    confidence: e.confidence,
    created_at: e.created_at
  }));
  const edges = [];
  for (const entity of entities) {
    const rels = engine.getRelationsFrom(entity.id);
    for (const rel of rels) {
      edges.push({
        from: entity.name,
        to: rel.to_name,
        relation: rel.relation,
        confidence: rel.confidence
      });
    }
  }
  return JSON.stringify({ nodes, edges, stats: engine.stats() }, null, 2);
}
function exportMermaid(engine, entities) {
  const lines = ["graph LR"];
  const nodeIds = /* @__PURE__ */ new Map();
  entities.forEach((e, i) => {
    const shortId = `n${i}`;
    nodeIds.set(e.id, shortId);
    const shape = getNodeShape(e.type);
    lines.push(`  ${shortId}${shape[0]}"${escapeMermaid(e.name)}"${shape[1]}`);
  });
  for (const entity of entities) {
    const rels = engine.getRelationsFrom(entity.id);
    for (const rel of rels) {
      const fromId = nodeIds.get(entity.id);
      const toId = nodeIds.get(rel.to_id);
      if (fromId && toId) {
        lines.push(`  ${fromId} -->|${escapeMermaid(rel.relation)}| ${toId}`);
      }
    }
  }
  return lines.join("\n");
}
function exportDOT(engine, entities) {
  const lines = [
    "digraph MemoryGraph {",
    "  rankdir=LR;",
    "  node [shape=box, style=rounded];",
    ""
  ];
  for (const entity of entities) {
    const label = `${entity.name}\\n(${entity.type})`;
    lines.push(`  "${entity.id}" [label="${escapeDOT(label)}"];`);
  }
  lines.push("");
  for (const entity of entities) {
    const rels = engine.getRelationsFrom(entity.id);
    for (const rel of rels) {
      lines.push(`  "${entity.id}" -> "${rel.to_id}" [label="${escapeDOT(rel.relation)}"];`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}
function exportCSV(engine, entities) {
  const lines = ["from_name,from_type,relation,to_name,to_type,confidence"];
  for (const entity of entities) {
    const rels = engine.getRelationsFrom(entity.id);
    for (const rel of rels) {
      lines.push(`"${entity.name}","${entity.type}","${rel.relation}","${rel.to_name}","${rel.to_type}",${rel.confidence}`);
    }
  }
  return lines.join("\n");
}
function getNodeShape(type) {
  switch (type.toLowerCase()) {
    case "person":
      return ["((", "))"];
    // Circle
    case "project":
      return ["[/", "/]"];
    // Parallelogram
    case "tool":
    case "technology":
      return ["{{", "}}"];
    // Hexagon
    default:
      return ["[", "]"];
  }
}
function escapeMermaid(text) {
  return text.replace(/"/g, "'").replace(/[[\]{}()]/g, "");
}
function escapeDOT(text) {
  return text.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
var init_export = __esm({
  "src/sync/export.js"() {
    "use strict";
  }
});

// src/sync/memory-md.js
import { readFileSync as readFileSync2, existsSync as existsSync2 } from "node:fs";
async function importFromMemoryMd(filePath, engine, config) {
  if (!existsSync2(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = readFileSync2(filePath, "utf-8");
  const sections = splitIntoSections(content);
  let totalEntities = 0;
  let totalRelationships = 0;
  for (const section of sections) {
    if (section.trim().length < 20)
      continue;
    try {
      const result = await extractFromText(section, config);
      for (const entity of result.entities) {
        engine.addEntity(entity.name, entity.type, entity.properties ?? {}, {
          source: filePath,
          confidence: entity.confidence
        });
        totalEntities++;
      }
      for (const rel of result.relationships) {
        engine.addRelation(rel.from, rel.relation, rel.to, {
          source: filePath,
          confidence: rel.confidence,
          fromType: rel.fromType,
          toType: rel.toType
        });
        totalRelationships++;
      }
    } catch (err) {
      console.warn(`[agent-memory-graph] Failed to extract from section: ${err}`);
    }
  }
  return { entities: totalEntities, relationships: totalRelationships };
}
async function importFromDirectory(dirPath, engine, config) {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  let totalEntities = 0;
  let totalRelationships = 0;
  let fileCount = 0;
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);
    if (stat.isFile() && (entry.endsWith(".md") || entry.endsWith(".txt"))) {
      const result = await importFromMemoryMd(fullPath, engine, config);
      totalEntities += result.entities;
      totalRelationships += result.relationships;
      fileCount++;
    }
  }
  return { entities: totalEntities, relationships: totalRelationships, files: fileCount };
}
function splitIntoSections(content) {
  const sections = content.split(/(?=^#{1,3}\s)/m);
  if (sections.length <= 1) {
    return content.split(/\n\n+/).filter((s) => s.trim().length > 0);
  }
  return sections.filter((s) => s.trim().length > 0);
}
var init_memory_md = __esm({
  "src/sync/memory-md.js"() {
    "use strict";
    init_extractor();
  }
});

// src/extract/dedup.js
function findDuplicates(engine, threshold = 0.85) {
  const entities = engine.listEntities({ limit: 1e4 });
  const duplicates = [];
  const processed = /* @__PURE__ */ new Set();
  for (let i = 0; i < entities.length; i++) {
    if (processed.has(entities[i].id)) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (processed.has(entities[j].id)) continue;
      if (entities[i].type.toLowerCase() !== entities[j].type.toLowerCase()) continue;
      const sim = nameSimilarity(entities[i].name, entities[j].name);
      if (sim >= threshold) {
        duplicates.push({
          entity: entities[j],
          duplicateOf: entities[i],
          similarity: sim
        });
        processed.add(entities[j].id);
      }
    }
  }
  return duplicates;
}
function mergeEntities(engine, keepId, mergeId) {
  const keep = engine.getEntity(keepId);
  const merge = engine.getEntity(mergeId);
  if (!keep || !merge) return false;
  const mergedProps = { ...merge.properties, ...keep.properties };
  engine.updateEntity(keepId, { properties: mergedProps });
  engine.reassignRelationships(mergeId, keepId);
  engine.deleteEntity(mergeId);
  return true;
}
function autoDedup(engine) {
  const entities = engine.listEntities({ limit: 1e4 });
  let mergeCount = 0;
  const merged = /* @__PURE__ */ new Set();
  for (let i = 0; i < entities.length; i++) {
    if (merged.has(entities[i].id)) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (merged.has(entities[j].id)) continue;
      if (entities[i].type.toLowerCase() !== entities[j].type.toLowerCase()) continue;
      const sim = nameSimilarity(entities[i].name, entities[j].name);
      if (sim >= 0.9) {
        const [keep, remove] = entities[i].name.length >= entities[j].name.length ? [entities[i], entities[j]] : [entities[j], entities[i]];
        mergeEntities(engine, keep.id, remove.id);
        merged.add(remove.id);
        mergeCount++;
      }
    }
  }
  return mergeCount;
}
function nameSimilarity(a, b) {
  const na = stripTitles(a.toLowerCase().trim());
  const nb = stripTitles(b.toLowerCase().trim());
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const rawA = a.toLowerCase().trim();
  const rawB = b.toLowerCase().trim();
  if (rawA !== na || rawB !== nb) {
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.92;
  }
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
function stripTitles(name) {
  const prefixes = /^(dr\.?|prof\.?|professor|mr\.?|mrs\.?|ms\.?|sir|lord|sếp|anh|chị|em)\s+/i;
  const suffixes = /\s+(inc\.?|corp\.?|ltd\.?|llc|co\.?|company|corporation|motors|labs|laboratory|laboratories|university|univ\.?)$/i;
  return name.replace(prefixes, "").replace(suffixes, "").trim();
}
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
var init_dedup = __esm({
  "src/extract/dedup.js"() {
    "use strict";
  }
});

// src/index.js
var src_exports = {};
__export(src_exports, {
  MemoryGraph: () => MemoryGraph
});
var MemoryGraph;
var init_src = __esm({
  "src/index.js"() {
    "use strict";
    init_engine();
    init_defaults();
    init_extractor();
    init_hybrid();
    init_natural_language();
    init_export();
    init_memory_md();
    init_dedup();
    MemoryGraph = class {
      engine;
      config;
      ingestCount = 0;
      DEDUP_INTERVAL = 10;
      // Run auto-dedup every N ingestions
      constructor(options = {}) {
        this.config = loadConfig(options.configPath);
        if (options.config) {
          this.config = { ...this.config, ...options.config };
        }
        const dbPath = options.path ?? this.config.storage.path;
        this.engine = new GraphEngine(dbPath);
      }
      // ─── Core API ──────────────────────────────────────────────────
      /**
       * Ingest text: extract entities and relationships, store in graph.
       */
      async ingest(text, options = {}) {
        const result = await extractFromText(text, this.config);
        for (const entity of result.entities) {
          this.engine.addEntity(entity.name, entity.type, entity.properties ?? {}, {
            source: options.source,
            confidence: entity.confidence
          });
        }
        for (const rel of result.relationships) {
          const props = {};
          if (rel.when) props.when = rel.when;
          this.engine.addRelation(rel.from, rel.relation, rel.to, {
            source: options.source,
            confidence: rel.confidence,
            fromType: rel.fromType,
            toType: rel.toType,
            properties: props
          });
        }
        this.engine.logExtraction(text, result.entities, result.relationships, options.sessionId);
        this.ingestCount++;
        if (this.ingestCount % this.DEDUP_INTERVAL === 0) {
          try {
            autoDedup(this.engine);
          } catch (_) {
          }
        }
        return result;
      }
      /**
       * Ask a natural language question against the graph.
       */
      async ask(question) {
        return naturalLanguageQuery(question, this.engine, this.config);
      }
      /**
       * Search entities by keyword.
       */
      search(query, limit) {
        return hybridSearch(this.engine, query, {
          ...this.config,
          query: { ...this.config.query, maxResults: limit ?? this.config.query.maxResults }
        });
      }
      // ─── Entity Management ─────────────────────────────────────────
      /**
       * Add an entity manually.
       */
      addEntity(name, type, properties = {}) {
        return this.engine.addEntity(name, type, properties);
      }
      /**
       * Add a relationship manually.
       */
      addRelation(from, relation, to, options) {
        return this.engine.addRelation(from, relation, to, options);
      }
      /**
       * Find an entity by name.
       */
      findEntity(name, type) {
        return this.engine.findEntityByName(name, type);
      }
      /**
       * List entities, optionally filtered by type.
       */
      listEntities(options) {
        return this.engine.listEntities(options);
      }
      /**
       * Delete an entity and its relationships.
       */
      deleteEntity(nameOrId) {
        const entity = this.engine.getEntity(nameOrId) ?? this.engine.findEntityByName(nameOrId);
        if (!entity) return false;
        return this.engine.deleteEntity(entity.id);
      }
      // ─── Graph Operations ──────────────────────────────────────────
      /**
       * Find shortest path between two entities.
       */
      findPath(from, to, maxHops) {
        return this.engine.findPath(from, to, maxHops ?? this.config.query.maxHops);
      }
      /**
       * Get all entities and relationships within N hops of an entity.
       */
      neighborhood(entityName, hops = 1) {
        return this.engine.getNeighborhood(entityName, hops);
      }
      // ─── Import / Export ───────────────────────────────────────────
      /**
       * Export graph to a format (json, mermaid, dot, csv).
       */
      export(format, options) {
        return exportGraph(this.engine, { format, ...options });
      }
      /**
       * Import from a MEMORY.md file or directory.
       */
      async importFrom(path) {
        const { statSync } = await import("node:fs");
        const stat = statSync(path);
        if (stat.isDirectory()) {
          const result = await importFromDirectory(path, this.engine, this.config);
          return { entities: result.entities, relationships: result.relationships };
        }
        return importFromMemoryMd(path, this.engine, this.config);
      }
      // ─── Maintenance ───────────────────────────────────────────────
      /**
       * Find and optionally merge duplicate entities.
       */
      deduplicate(options) {
        const threshold = options?.threshold ?? this.config.deduplication.similarityThreshold;
        const duplicates = findDuplicates(this.engine, threshold);
        if (options?.autoMerge) {
          for (const dup of duplicates) {
            mergeEntities(this.engine, dup.duplicateOf.id, dup.entity.id);
          }
        }
        return duplicates.map((d) => ({
          entity: d.entity.name,
          duplicateOf: d.duplicateOf.name,
          similarity: d.similarity
        }));
      }
      /**
       * Get graph statistics.
       */
      stats() {
        return this.engine.stats();
      }
      /**
       * Close database connection.
       */
      close() {
        this.engine.close();
      }
    };
  }
});

// plugin/entry.js
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolve as resolve3 } from "node:path";
import { homedir } from "node:os";
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.MEMORY_GRAPH_API_KEY || "sk-local";
}
if (!process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL = process.env.MEMORY_GRAPH_BASE_URL || "http://127.0.0.1:20128/v1";
}
var Type = {
  Object: (props) => ({ type: "object", properties: props, required: Object.keys(props).filter((k) => !props[k]._optional) }),
  String: (opts) => ({ type: "string", ...opts }),
  Number: (opts) => ({ type: "number", ...opts }),
  Optional: (schema) => ({ ...schema, _optional: true })
};
var graphInstance = null;
function getDbPath(config) {
  const raw = config?.dbPath || "~/.openclaw/data/memory-graph.db";
  return raw.startsWith("~") ? resolve3(homedir(), raw.slice(2)) : resolve3(raw);
}
async function getGraph(config) {
  if (!graphInstance) {
    const { MemoryGraph: MemoryGraph2 } = await Promise.resolve().then(() => (init_src(), src_exports));
    graphInstance = new MemoryGraph2({
      path: getDbPath(config),
      config: {
        extraction: {
          provider: "openai",
          model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
          autoExtract: true,
          minConfidence: config?.minConfidence ?? 0.7,
          batchSize: 5
        },
        domains: config?.domains ?? [],
        query: {
          maxHops: config?.maxHops ?? 3,
          maxResults: 10,
          includeConfidence: true
        }
      }
    });
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "sk-local";
    }
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = "http://127.0.0.1:20128/v1";
    }
  }
  return graphInstance;
}
var messageBuffer = [];
var batchTimer = null;
var BATCH_WINDOW_MS = 15e3;
var BATCH_MAX_MESSAGES = 5;
var sessionMessages = /* @__PURE__ */ new Map();
var SESSION_SUMMARY_MIN_MESSAGES = 5;
var SESSION_SUMMARY_MAX_BUFFER = 50;
async function flushBatch(config) {
  if (messageBuffer.length === 0) return;
  const batch = messageBuffer.splice(0, messageBuffer.length);
  const combinedText = batch.map((m) => m.text).join("\n");
  const source = `chat:${batch[0].senderId}`;
  const sessionKey = batch[0].sessionKey;
  try {
    const graph = await getGraph(config);
    await graph.ingest(combinedText, { source, sessionId: sessionKey });
  } catch (err) {
    console.warn("[memory-graph] Batch ingest failed:", err.message);
  }
}
var COMMAND_PATTERNS = /^\s*[\/!](new|reset|status|help|start|stop|restart|approve|elevated|exec|reasoning|model|clear)\b/i;
var TOKEN_PATTERNS = /(?:npm_|clh_|ghp_|gho_|sk-|xox[bpas]-|Bearer\s+|token[:\s]+\S{20,}|[A-Za-z0-9_-]{40,})/;
var CASUAL_PATTERNS = /^\s*(ok|oke|okie|oki|yes|no|yep|nope|sure|đi|đc|dc|ừ|ờ|uh|hmm|hm|ah|oh|wow|nice|cool|good|great|thanks|thx|cảm ơn|sao rồi|sao r|ổn không|ổn k|gà ơi|gà|em ơi|sếp ơi|aira ơi|tiếp|tiếp đi|continue|go|done|xong|rồi|chưa|có|không|ko|k|đúng|sai|được|đc rồi|ok em|ok anh)\s*[?!.]*\s*$/i;
var URL_ONLY_PATTERN = /^\s*(https?:\/\/\S+\s*)+$/;
var MIN_MEANINGFUL_LENGTH = 30;
var MIN_WORD_COUNT = 5;
function shouldIngest(text) {
  if (text.length < MIN_MEANINGFUL_LENGTH) return false;
  if (COMMAND_PATTERNS.test(text)) return false;
  if (TOKEN_PATTERNS.test(text)) return false;
  if (CASUAL_PATTERNS.test(text)) return false;
  if (URL_ONLY_PATTERN.test(text)) return false;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 1).length;
  if (wordCount < MIN_WORD_COUNT) return false;
  return true;
}
var entry_default = definePluginEntry({
  id: "memory-graph",
  name: "Memory Graph",
  description: "Auto-builds a knowledge graph from conversations. Extracts entities/relationships and exposes graph query tools.",
  register(api) {
    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        const config = ctx?.pluginConfig;
        if (config?.promptInjection === false) return;
        try {
          const graph = await getGraph(config);
          const stats = graph.stats();
          if (stats.entities === 0) return;
          const prompt = event.prompt || "";
          let contextLines = [];
          const PRIORITY_TYPES = ["Project", "Person", "Platform", "Organization", "Company", "Event", "System"];
          const SKIP_TYPES = ["Tool", "Concept", "File", "Award"];
          if (prompt && prompt.length > 20) {
            const searchQuery = prompt.slice(0, 100).replace(/[\n\r]+/g, " ").trim();
            const results = graph.search(searchQuery, 15);
            if (results.length > 0) {
              const filtered = results.filter((r) => !SKIP_TYPES.includes(r.entity.type)).sort((a, b) => {
                const aPriority = PRIORITY_TYPES.indexOf(a.entity.type);
                const bPriority = PRIORITY_TYPES.indexOf(b.entity.type);
                const aScore = (aPriority >= 0 ? 100 - aPriority : 50) + (a.relations?.length || 0);
                const bScore = (bPriority >= 0 ? 100 - bPriority : 50) + (b.relations?.length || 0);
                return bScore - aScore;
              }).slice(0, 5);
              if (filtered.length > 0) {
                contextLines = filtered.map((r) => {
                  const rels = r.relations?.filter((rel) => !SKIP_TYPES.includes(rel.targetType || "")).slice(0, 3).map((rel) => `${rel.direction === "outgoing" ? "\u2192" : "\u2190"} ${rel.relation} ${rel.target}`).join(", ") || "";
                  return `${r.entity.name} (${r.entity.type})${rels ? ": " + rels : ""}`;
                });
              }
            }
          }
          if (contextLines.length === 0) {
            const allEntities = graph.listEntities({ limit: 30, sortBy: "updated_at" });
            const prioritized = allEntities.filter((e) => !SKIP_TYPES.includes(e.type)).sort((a, b) => {
              const aPriority = PRIORITY_TYPES.indexOf(a.type);
              const bPriority = PRIORITY_TYPES.indexOf(b.type);
              return (bPriority >= 0 ? bPriority : -1) - (aPriority >= 0 ? aPriority : -1);
            }).slice(0, 5);
            if (prioritized.length > 0) {
              contextLines = prioritized.map((e) => `${e.name} (${e.type})`);
            }
          }
          if (contextLines.length === 0) return;
          const injection = `## Knowledge Graph Context (auto-injected by memory-graph plugin)
Relevant entities from your knowledge graph:
${contextLines.join("\n")}

Use memory_graph_query or memory_graph_search tools for more details when needed.`;
          return { appendContext: injection };
        } catch (err) {
          console.warn("[memory-graph] Prompt injection failed:", err.message);
          return;
        }
      },
      { priority: 10 }
    );
    api.on(
      "message_received",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.autoIngest === false) return;
        const text = typeof event.content === "string" ? event.content : event.content?.text || event.content?.body || "";
        if (!text || !shouldIngest(text)) return;
        const sessionKey = event.sessionKey || "";
        if (sessionKey) {
          if (!sessionMessages.has(sessionKey)) sessionMessages.set(sessionKey, []);
          const msgs = sessionMessages.get(sessionKey);
          msgs.push({ text, role: "user", timestamp: Date.now() });
          if (msgs.length > SESSION_SUMMARY_MAX_BUFFER) msgs.shift();
        }
        messageBuffer.push({
          text,
          senderId: event.senderId || "unknown",
          sessionKey,
          timestamp: Date.now()
        });
        if (messageBuffer.length >= BATCH_MAX_MESSAGES) {
          if (batchTimer) {
            clearTimeout(batchTimer);
            batchTimer = null;
          }
          await flushBatch(config);
          return;
        }
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(() => {
          batchTimer = null;
          flushBatch(config).catch((err) => {
            console.warn("[memory-graph] Batch flush failed:", err.message);
          });
        }, BATCH_WINDOW_MS);
      },
      { priority: 10 }
    );
    api.on(
      "message_sent",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.sessionSummary === false) return;
        const text = typeof event.content === "string" ? event.content : event.content?.text || "";
        const sessionKey = event.sessionKey || "";
        if (!text || !sessionKey || text.length < MIN_MEANINGFUL_LENGTH) return;
        if (!sessionMessages.has(sessionKey)) sessionMessages.set(sessionKey, []);
        const msgs = sessionMessages.get(sessionKey);
        msgs.push({ text: text.slice(0, 500), role: "assistant", timestamp: Date.now() });
        if (msgs.length > SESSION_SUMMARY_MAX_BUFFER) msgs.shift();
      },
      { priority: 10 }
    );
    api.on(
      "agent_end",
      async (event, ctx) => {
        const config = ctx?.pluginConfig;
        const sessionKey = ctx?.sessionKey || "";
        const messages = event.messages || [];
        console.log(`[memory-graph] agent_end fired: sessionKey=${sessionKey}, messages=${messages.length}, success=${event.success}`);
        if (config?.sessionSummary === false) return;
        if (!sessionKey) return;
        const textParts = [];
        for (const msg of messages) {
          const role = msg.role || "unknown";
          if (role !== "user" && role !== "assistant") continue;
          const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join(" ") : "";
          if (!text || text.length < MIN_MEANINGFUL_LENGTH) continue;
          textParts.push(`[${role}]: ${text.slice(0, 500)}`);
        }
        if (textParts.length < 2) return;
        const transcript = textParts.join("\n").slice(0, 3e3);
        try {
          const graph = await getGraph(config);
          const { OpenAI } = await import("openai");
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL
          });
          const summaryResponse = await client.chat.completions.create({
            model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
            messages: [
              {
                role: "system",
                content: `You are a session summarizer for a knowledge graph. Given a conversation transcript, extract a 2-4 sentence summary of KEY ACTIONS taken (what was built, fixed, published, decided, configured). Focus on concrete outcomes, versions, platforms, and decisions. Skip casual chat and test/debug noise. If nothing meaningful happened, respond with "NO_SUMMARY". Output plain text only.`
              },
              { role: "user", content: transcript }
            ],
            max_tokens: 300,
            temperature: 0.3
          });
          const summary = summaryResponse.choices?.[0]?.message?.content?.trim();
          if (summary && summary !== "NO_SUMMARY" && summary.length >= 20) {
            const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
            await graph.ingest(summary, { source: `session-summary-${today}`, sessionId: sessionKey });
            console.log(`[memory-graph] Session summary ingested (${textParts.length} msgs \u2192 ${summary.length} chars)`);
          } else {
            console.log(`[memory-graph] No meaningful summary for session (${textParts.length} msgs)`);
          }
        } catch (err) {
          console.warn("[memory-graph] Session summary failed:", err.message);
        }
      },
      { priority: 10 }
    );
    api.on(
      "session_end",
      async (event, ctx) => {
        const config = ctx?.pluginConfig;
        if (config?.sessionSummary === false) return;
        const sessionKey = event.sessionKey || event.sessionId || "";
        const msgs = sessionMessages.get(sessionKey);
        sessionMessages.delete(sessionKey);
        if (!msgs || msgs.length < SESSION_SUMMARY_MIN_MESSAGES) return;
        try {
          const graph = await getGraph(config);
          const transcript = msgs.map((m) => `[${m.role}]: ${m.text}`).join("\n").slice(0, 3e3);
          const { OpenAI } = await import("openai");
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL
          });
          const summaryResponse = await client.chat.completions.create({
            model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
            messages: [
              {
                role: "system",
                content: `You are a session summarizer for a knowledge graph. Given a conversation transcript, extract a 2-4 sentence summary of KEY ACTIONS taken (what was built, fixed, published, decided, configured). Focus on concrete outcomes, versions, platforms, and decisions. Skip casual chat. If nothing meaningful happened, respond with "NO_SUMMARY". Output plain text only.`
              },
              {
                role: "user",
                content: transcript
              }
            ],
            max_tokens: 300,
            temperature: 0.3
          });
          const summary = summaryResponse.choices?.[0]?.message?.content?.trim();
          if (!summary || summary === "NO_SUMMARY" || summary.length < 20) return;
          const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
          await graph.ingest(summary, {
            source: `session-summary-${today}`,
            sessionId: sessionKey
          });
          console.log(`[memory-graph] Session summary ingested (${msgs.length} messages \u2192 ${summary.length} chars)`);
        } catch (err) {
          console.warn("[memory-graph] Session summary ingestion failed:", err.message);
        }
      },
      { priority: 10 }
    );
    api.on("gateway_stop", async () => {
      for (const [key, msgs] of sessionMessages.entries()) {
        if (msgs.length >= SESSION_SUMMARY_MIN_MESSAGES) {
          try {
            const graph = await getGraph(null);
            const transcript = msgs.map((m) => `[${m.role}]: ${m.text}`).join("\n").slice(0, 3e3);
            const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
            await graph.ingest(`Session ended during shutdown. Messages: ${transcript.slice(0, 500)}`, {
              source: `session-summary-${today}-shutdown`,
              sessionId: key
            });
          } catch (_) {
          }
        }
      }
      sessionMessages.clear();
      if (graphInstance) {
        graphInstance.close();
        graphInstance = null;
      }
    });
    api.registerTool({
      name: "memory_graph_query",
      description: "Ask a natural language question against the knowledge graph. Use for relationship questions like 'What does Alice work on?', 'How is X connected to Y?', 'List all projects'.",
      parameters: Type.Object({
        question: Type.String({ description: "Natural language question" })
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const result = await graph.ask(params.question);
        return {
          content: [
            {
              type: "text",
              text: `${result.answer}${result.confidence < 0.5 ? `
(Low confidence: ${(result.confidence * 100).toFixed(0)}%)` : ""}`
            }
          ]
        };
      }
    });
    api.registerTool({
      name: "memory_graph_ingest",
      description: "Manually extract entities and relationships from text and store in the knowledge graph. Use when you want to explicitly add information.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to extract entities from" }),
        source: Type.Optional(Type.String({ description: "Source label" }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const result = await graph.ingest(params.text, { source: params.source || "manual" });
        const entities = result.entities.map((e) => `${e.name} (${e.type})`).join(", ");
        const rels = result.relationships.map((r) => `${r.from} -[${r.relation}]-> ${r.to}`).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Extracted ${result.entities.length} entities: ${entities}
Relationships (${result.relationships.length}): ${rels}`
            }
          ]
        };
      }
    });
    api.registerTool({
      name: "memory_graph_search",
      description: "Search entities in the knowledge graph by keyword or type. Returns matching entities with their relationships.",
      parameters: Type.Object({
        query: Type.String({ description: "Search keyword" }),
        type: Type.Optional(Type.String({ description: "Filter by entity type" })),
        limit: Type.Optional(Type.Number({ description: "Max results", default: 10 }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        if (params.type) {
          const entities = graph.listEntities({ type: params.type, limit: params.limit || 10 });
          const lines2 = entities.map((e) => `${e.name} (${e.type})`);
          return {
            content: [{ type: "text", text: lines2.length > 0 ? lines2.join("\n") : "No entities found." }]
          };
        }
        const results = graph.search(params.query, params.limit || 10);
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No results found." }] };
        }
        const lines = results.map((r) => {
          const rels = r.relations.map((rel) => `${rel.direction === "outgoing" ? "\u2192" : "\u2190"} ${rel.relation} ${rel.target}`).join("; ");
          return `${r.entity.name} (${r.entity.type})${rels ? ": " + rels : ""}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
    });
    api.registerTool({
      name: "memory_graph_path",
      description: "Find the shortest path between two entities in the knowledge graph. Shows how they are connected through relationships.",
      parameters: Type.Object({
        from: Type.String({ description: "Starting entity name" }),
        to: Type.String({ description: "Target entity name" }),
        maxHops: Type.Optional(Type.Number({ description: "Maximum traversal hops", default: 3 }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const path = graph.findPath(params.from, params.to, params.maxHops || 3);
        if (!path) {
          return {
            content: [{ type: "text", text: `No path found between "${params.from}" and "${params.to}".` }]
          };
        }
        const display = path.path.map((node, i) => i < path.relations.length ? `${node} ${path.relations[i]}` : node).join(" ");
        return { content: [{ type: "text", text: `Path: ${display}` }] };
      }
    });
    api.registerTool({
      name: "memory_graph_stats",
      description: "Show knowledge graph statistics: entity count, relationship count, types.",
      parameters: Type.Object({}),
      async execute(_id, _params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const stats = graph.stats();
        return {
          content: [
            {
              type: "text",
              text: [
                `Entities: ${stats.entities}`,
                `Relationships: ${stats.relationships}`,
                `Entity types: ${stats.entityTypes.join(", ") || "(none)"}`,
                `Relation types: ${stats.relationTypes.join(", ") || "(none)"}`,
                `Oldest: ${stats.oldestEntry || "(empty)"}`,
                `Newest: ${stats.newestEntry || "(empty)"}`
              ].join("\n")
            }
          ]
        };
      }
    });
  }
});
export {
  entry_default as default
};
