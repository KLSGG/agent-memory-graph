import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { SchemaManager } from './schema.js';

export interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  source?: string;
  confidence: number;
}

export interface Relationship {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  source?: string;
  confidence: number;
}

export interface GraphStats {
  entities: number;
  relationships: number;
  entityTypes: string[];
  relationTypes: string[];
  oldestEntry: string | null;
  newestEntry: string | null;
}

export class GraphEngine {
  private db: Database.Database;

  constructor(dbPath: string) {
    const schema = new SchemaManager(dbPath);
    this.db = schema.initialize();
  }

  // ─── Entity CRUD ───────────────────────────────────────────────

  addEntity(
    name: string,
    type: string,
    properties: Record<string, unknown> = {},
    options: { source?: string; confidence?: number } = {}
  ): Entity {
    const existing = this.findEntityByName(name, type);
    if (existing) {
      // Update existing entity
      return this.updateEntity(existing.id, { properties, ...options });
    }

    const id = `e-${nanoid(12)}`;
    const now = new Date().toISOString();

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
      options.confidence ?? 1.0
    );

    return { id, name, type, properties, created_at: now, updated_at: now, source: options.source, confidence: options.confidence ?? 1.0 };
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as any;
    return row ? this.rowToEntity(row) : null;
  }

  findEntityByName(name: string, type?: string): Entity | null {
    const query = type
      ? `SELECT * FROM entities WHERE name = ? COLLATE NOCASE AND type = ? COLLATE NOCASE LIMIT 1`
      : `SELECT * FROM entities WHERE name = ? COLLATE NOCASE LIMIT 1`;

    const row = type
      ? this.db.prepare(query).get(name, type) as any
      : this.db.prepare(query).get(name) as any;

    return row ? this.rowToEntity(row) : null;
  }

  updateEntity(
    id: string,
    updates: { name?: string; type?: string; properties?: Record<string, unknown>; source?: string; confidence?: number }
  ): Entity {
    const existing = this.getEntity(id);
    if (!existing) throw new Error(`Entity ${id} not found`);

    const merged = {
      name: updates.name ?? existing.name,
      type: updates.type ?? existing.type,
      properties: updates.properties ? { ...existing.properties, ...updates.properties } : existing.properties,
      source: updates.source ?? existing.source,
      confidence: updates.confidence ?? existing.confidence,
    };

    const now = new Date().toISOString();

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

  deleteEntity(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  listEntities(options: { type?: string; limit?: number; offset?: number } = {}): Entity[] {
    const { type, limit = 100, offset = 0 } = options;

    const query = type
      ? `SELECT * FROM entities WHERE type = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      : `SELECT * FROM entities ORDER BY updated_at DESC LIMIT ? OFFSET ?`;

    const rows = type
      ? this.db.prepare(query).all(type, limit, offset) as any[]
      : this.db.prepare(query).all(limit, offset) as any[];

    return rows.map(r => this.rowToEntity(r));
  }

  // ─── Relationship CRUD ─────────────────────────────────────────

  addRelation(
    fromName: string,
    relation: string,
    toName: string,
    options: { properties?: Record<string, unknown>; source?: string; confidence?: number; fromType?: string; toType?: string } = {}
  ): Relationship {
    // Resolve entities by name (create if not exist)
    let fromEntity = this.findEntityByName(fromName);
    if (!fromEntity) {
      fromEntity = this.addEntity(fromName, options.fromType ?? 'Unknown', {}, { source: options.source });
    }

    let toEntity = this.findEntityByName(toName);
    if (!toEntity) {
      toEntity = this.addEntity(toName, options.toType ?? 'Unknown', {}, { source: options.source });
    }

    // Check for existing relationship
    const existing = this.db.prepare(`
      SELECT * FROM relationships WHERE from_id = ? AND to_id = ? AND relation = ? COLLATE NOCASE LIMIT 1
    `).get(fromEntity.id, toEntity.id, relation) as any;

    if (existing) {
      // Update confidence/properties
      const now = new Date().toISOString();
      const mergedProps = { ...JSON.parse(existing.properties || '{}'), ...(options.properties ?? {}) };
      this.db.prepare(`
        UPDATE relationships SET properties = ?, confidence = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(mergedProps), options.confidence ?? existing.confidence, now, existing.id);
      return this.rowToRelationship({ ...existing, properties: JSON.stringify(mergedProps), updated_at: now });
    }

    const id = `r-${nanoid(12)}`;
    const now = new Date().toISOString();

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
      options.confidence ?? 1.0
    );

    return {
      id, from_id: fromEntity.id, to_id: toEntity.id, relation,
      properties: options.properties ?? {}, created_at: now, updated_at: now,
      source: options.source, confidence: options.confidence ?? 1.0
    };
  }

  getRelationsFrom(entityId: string): (Relationship & { to_name: string; to_type: string })[] {
    const rows = this.db.prepare(`
      SELECT r.*, e.name as to_name, e.type as to_type
      FROM relationships r
      JOIN entities e ON r.to_id = e.id
      WHERE r.from_id = ?
      ORDER BY r.updated_at DESC
    `).all(entityId) as any[];

    return rows.map(r => ({ ...this.rowToRelationship(r), to_name: r.to_name, to_type: r.to_type }));
  }

  getRelationsTo(entityId: string): (Relationship & { from_name: string; from_type: string })[] {
    const rows = this.db.prepare(`
      SELECT r.*, e.name as from_name, e.type as from_type
      FROM relationships r
      JOIN entities e ON r.from_id = e.id
      WHERE r.to_id = ?
      ORDER BY r.updated_at DESC
    `).all(entityId) as any[];

    return rows.map(r => ({ ...this.rowToRelationship(r), from_name: r.from_name, from_type: r.from_type }));
  }

  deleteRelation(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM relationships WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ─── Search ────────────────────────────────────────────────────

  searchEntities(query: string, limit = 10): Entity[] {
    // Sanitize query for FTS5 (remove special characters)
    const sanitized = query.replace(/[?!@#$%^&*(){}\[\]<>:;"'`~|/\\+=]/g, ' ').trim();

    if (sanitized.length > 0) {
      // Try FTS first
      try {
        const ftsRows = this.db.prepare(`
          SELECT e.* FROM entities_fts fts
          JOIN entities e ON e.rowid = fts.rowid
          WHERE entities_fts MATCH ?
          LIMIT ?
        `).all(sanitized, limit) as any[];

        if (ftsRows.length > 0) {
          return ftsRows.map(r => this.rowToEntity(r));
        }
      } catch {
        // FTS query failed, fall through to LIKE
      }
    }

    // Fallback to LIKE search
    const likeQuery = sanitized.length > 0 ? sanitized : query;
    const likeRows = this.db.prepare(`
      SELECT * FROM entities
      WHERE name LIKE ? COLLATE NOCASE OR type LIKE ? COLLATE NOCASE
      LIMIT ?
    `).all(`%${likeQuery}%`, `%${likeQuery}%`, limit) as any[];

    return likeRows.map(r => this.rowToEntity(r));
  }

  // ─── Graph Traversal ───────────────────────────────────────────

  /**
   * Find path between two entities (BFS, max depth)
   */
  findPath(fromName: string, toName: string, maxHops = 3): { path: string[]; relations: string[] } | null {
    const fromEntity = this.findEntityByName(fromName);
    const toEntity = this.findEntityByName(toName);
    if (!fromEntity || !toEntity) return null;

    // BFS
    const queue: { entityId: string; path: string[]; relations: string[] }[] = [
      { entityId: fromEntity.id, path: [fromEntity.name], relations: [] }
    ];
    const visited = new Set<string>([fromEntity.id]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxHops + 1) break;

      // Get all neighbors (both directions)
      const outgoing = this.db.prepare(`
        SELECT r.relation, r.to_id as neighbor_id, e.name as neighbor_name
        FROM relationships r JOIN entities e ON r.to_id = e.id
        WHERE r.from_id = ?
      `).all(current.entityId) as any[];

      const incoming = this.db.prepare(`
        SELECT r.relation, r.from_id as neighbor_id, e.name as neighbor_name
        FROM relationships r JOIN entities e ON r.from_id = e.id
        WHERE r.to_id = ?
      `).all(current.entityId) as any[];

      const neighbors = [
        ...outgoing.map((n: any) => ({ ...n, direction: '->' })),
        ...incoming.map((n: any) => ({ ...n, direction: '<-' })),
      ];

      for (const neighbor of neighbors) {
        if (neighbor.neighbor_id === toEntity.id) {
          return {
            path: [...current.path, neighbor.neighbor_name],
            relations: [...current.relations, `${neighbor.direction}[${neighbor.relation}]`],
          };
        }

        if (!visited.has(neighbor.neighbor_id)) {
          visited.add(neighbor.neighbor_id);
          queue.push({
            entityId: neighbor.neighbor_id,
            path: [...current.path, neighbor.neighbor_name],
            relations: [...current.relations, `${neighbor.direction}[${neighbor.relation}]`],
          });
        }
      }
    }

    return null;
  }

  /**
   * Get neighborhood of an entity (all connected within N hops)
   */
  getNeighborhood(entityName: string, hops = 1): { entities: Entity[]; relationships: Relationship[] } {
    const entity = this.findEntityByName(entityName);
    if (!entity) return { entities: [], relationships: [] };

    const entityIds = new Set<string>([entity.id]);
    const relIds = new Set<string>();
    let frontier = [entity.id];

    for (let i = 0; i < hops; i++) {
      const nextFrontier: string[] = [];

      for (const nodeId of frontier) {
        const rels = this.db.prepare(`
          SELECT * FROM relationships WHERE from_id = ? OR to_id = ?
        `).all(nodeId, nodeId) as any[];

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

    const entities = [...entityIds]
      .map(id => this.getEntity(id))
      .filter((e): e is Entity => e !== null);

    const relationships = [...relIds]
      .map(id => {
        const row = this.db.prepare(`SELECT * FROM relationships WHERE id = ?`).get(id) as any;
        return row ? this.rowToRelationship(row) : null;
      })
      .filter((r): r is Relationship => r !== null);

    return { entities, relationships };
  }

  // ─── Stats ─────────────────────────────────────────────────────

  stats(): GraphStats {
    const entityCount = (this.db.prepare(`SELECT COUNT(*) as c FROM entities`).get() as any).c;
    const relCount = (this.db.prepare(`SELECT COUNT(*) as c FROM relationships`).get() as any).c;

    const entityTypes = (this.db.prepare(`SELECT DISTINCT type FROM entities ORDER BY type`).all() as any[])
      .map(r => r.type);
    const relationTypes = (this.db.prepare(`SELECT DISTINCT relation FROM relationships ORDER BY relation`).all() as any[])
      .map(r => r.relation);

    const oldest = this.db.prepare(`SELECT MIN(created_at) as t FROM entities`).get() as any;
    const newest = this.db.prepare(`SELECT MAX(updated_at) as t FROM entities`).get() as any;

    return {
      entities: entityCount,
      relationships: relCount,
      entityTypes,
      relationTypes,
      oldestEntry: oldest?.t ?? null,
      newestEntry: newest?.t ?? null,
    };
  }

  // ─── Memory Log ────────────────────────────────────────────────

  logExtraction(rawText: string, entities: any[], relations: any[], sessionId?: string): void {
    const id = `log-${nanoid(12)}`;
    this.db.prepare(`
      INSERT INTO memory_log (id, raw_text, extracted_entities, extracted_relations, session_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, rawText, JSON.stringify(entities), JSON.stringify(relations), sessionId ?? null);
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private rowToEntity(row: any): Entity {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      properties: JSON.parse(row.properties || '{}'),
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source ?? undefined,
      confidence: row.confidence,
    };
  }

  private rowToRelationship(row: any): Relationship {
    return {
      id: row.id,
      from_id: row.from_id,
      to_id: row.to_id,
      relation: row.relation,
      properties: JSON.parse(row.properties || '{}'),
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source ?? undefined,
      confidence: row.confidence,
    };
  }

  /** Close database */
  close(): void {
    this.db.close();
  }
}
