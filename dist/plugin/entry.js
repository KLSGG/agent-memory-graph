var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
import { nanoid } from "nanoid";
var GraphEngine;
var init_engine = __esm({
  "src/graph/engine.js"() {
    "use strict";
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
          confidence: row.confidence
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

// src/config/schema.js
import { z } from "zod";
var DomainSchema, SyncSchema, ConfigSchema;
var init_schema2 = __esm({
  "src/config/schema.js"() {
    "use strict";
    DomainSchema = z.object({
      name: z.string(),
      entityHints: z.array(z.string()).default([]),
      relationHints: z.array(z.string()).default([])
    });
    SyncSchema = z.object({
      memoryMd: z.string().nullable().default(null),
      neuralMemory: z.string().nullable().default(null),
      importOnStart: z.boolean().default(false)
    });
    ConfigSchema = z.object({
      storage: z.object({
        path: z.string().default("./memory-graph.db"),
        maxSizeMb: z.number().default(500)
      }).default({}),
      extraction: z.object({
        provider: z.enum(["auto", "openai", "anthropic", "ollama"]).default("auto"),
        model: z.string().default("auto"),
        autoExtract: z.boolean().default(true),
        minConfidence: z.number().min(0).max(1).default(0.7),
        batchSize: z.number().default(5)
      }).default({}),
      domains: z.array(DomainSchema).default([]),
      deduplication: z.object({
        enabled: z.boolean().default(true),
        similarityThreshold: z.number().min(0).max(1).default(0.85)
      }).default({}),
      sync: SyncSchema.default({}),
      query: z.object({
        maxHops: z.number().default(5),
        maxResults: z.number().default(50),
        includeConfidence: z.boolean().default(true)
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
      confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0.8))
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
    `${entity.name} (${entity.type})`
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
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
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

// plugin/entry.ts
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
      "message_received",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.autoIngest === false) return;
        const text = typeof event.content === "string" ? event.content : event.content?.text || event.content?.body || "";
        if (!text || !shouldIngest(text)) return;
        messageBuffer.push({
          text,
          senderId: event.senderId || "unknown",
          sessionKey: event.sessionKey || "",
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
    api.on("gateway_stop", async () => {
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
