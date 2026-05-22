import { nanoid } from 'nanoid';
import { SchemaManager } from './schema.js';
export class GraphEngine {
    db;
    constructor(dbPath) {
        const schema = new SchemaManager(dbPath);
        this.db = schema.initialize();
    }
    // ─── Entity CRUD ───────────────────────────────────────────────
    addEntity(name, type, properties = {}, options = {}) {
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
    `).run(id, name, type, JSON.stringify(properties), now, now, options.source ?? null, options.confidence ?? 1.0);
        return { id, name, type, properties, created_at: now, updated_at: now, source: options.source, confidence: options.confidence ?? 1.0 };
    }
    getEntity(id) {
        const row = this.db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id);
        return row ? this.rowToEntity(row) : null;
    }
    findEntityByName(name, type) {
        const query = type
            ? `SELECT * FROM entities WHERE name = ? COLLATE NOCASE AND type = ? COLLATE NOCASE LIMIT 1`
            : `SELECT * FROM entities WHERE name = ? COLLATE NOCASE LIMIT 1`;
        const row = type
            ? this.db.prepare(query).get(name, type)
            : this.db.prepare(query).get(name);
        return row ? this.rowToEntity(row) : null;
    }
    updateEntity(id, updates) {
        const existing = this.getEntity(id);
        if (!existing)
            throw new Error(`Entity ${id} not found`);
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
    `).run(merged.name, merged.type, JSON.stringify(merged.properties), merged.source ?? null, merged.confidence, now, id);
        return { ...existing, ...merged, updated_at: now };
    }
    deleteEntity(id) {
        const result = this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
        return result.changes > 0;
    }
    listEntities(options = {}) {
        const { type, limit = 100, offset = 0 } = options;
        const query = type
            ? `SELECT * FROM entities WHERE type = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT ? OFFSET ?`
            : `SELECT * FROM entities ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
        const rows = type
            ? this.db.prepare(query).all(type, limit, offset)
            : this.db.prepare(query).all(limit, offset);
        return rows.map(r => this.rowToEntity(r));
    }
    // ─── Relationship CRUD ─────────────────────────────────────────
    addRelation(fromName, relation, toName, options = {}) {
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
    `).get(fromEntity.id, toEntity.id, relation);
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
    `).run(id, fromEntity.id, toEntity.id, relation, JSON.stringify(options.properties ?? {}), now, now, options.source ?? null, options.confidence ?? 1.0);
        return {
            id, from_id: fromEntity.id, to_id: toEntity.id, relation,
            properties: options.properties ?? {}, created_at: now, updated_at: now,
            source: options.source, confidence: options.confidence ?? 1.0
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
        return rows.map(r => ({ ...this.rowToRelationship(r), to_name: r.to_name, to_type: r.to_type }));
    }
    getRelationsTo(entityId) {
        const rows = this.db.prepare(`
      SELECT r.*, e.name as from_name, e.type as from_type
      FROM relationships r
      JOIN entities e ON r.from_id = e.id
      WHERE r.to_id = ?
      ORDER BY r.updated_at DESC
    `).all(entityId);
        return rows.map(r => ({ ...this.rowToRelationship(r), from_name: r.from_name, from_type: r.from_type }));
    }
    deleteRelation(id) {
        const result = this.db.prepare(`DELETE FROM relationships WHERE id = ?`).run(id);
        return result.changes > 0;
    }
    // ─── Search ────────────────────────────────────────────────────
    searchEntities(query, limit = 10) {
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
        `).all(sanitized, limit);
                if (ftsRows.length > 0) {
                    return ftsRows.map(r => this.rowToEntity(r));
                }
            }
            catch {
                // FTS query failed, fall through to LIKE
            }
        }
        // Fallback to LIKE search
        const likeQuery = sanitized.length > 0 ? sanitized : query;
        const likeRows = this.db.prepare(`
      SELECT * FROM entities
      WHERE name LIKE ? COLLATE NOCASE OR type LIKE ? COLLATE NOCASE
      LIMIT ?
    `).all(`%${likeQuery}%`, `%${likeQuery}%`, limit);
        return likeRows.map(r => this.rowToEntity(r));
    }
    // ─── Graph Traversal ───────────────────────────────────────────
    /**
     * Find path between two entities (BFS, max depth)
     */
    findPath(fromName, toName, maxHops = 3) {
        const fromEntity = this.findEntityByName(fromName);
        const toEntity = this.findEntityByName(toName);
        if (!fromEntity || !toEntity)
            return null;
        // BFS
        const queue = [
            { entityId: fromEntity.id, path: [fromEntity.name], relations: [] }
        ];
        const visited = new Set([fromEntity.id]);
        while (queue.length > 0) {
            const current = queue.shift();
            if (current.path.length > maxHops + 1)
                break;
            // Get all neighbors (both directions)
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
                ...outgoing.map((n) => ({ ...n, direction: '->' })),
                ...incoming.map((n) => ({ ...n, direction: '<-' })),
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
    getNeighborhood(entityName, hops = 1) {
        const entity = this.findEntityByName(entityName);
        if (!entity)
            return { entities: [], relationships: [] };
        const entityIds = new Set([entity.id]);
        const relIds = new Set();
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
        const entities = [...entityIds]
            .map(id => this.getEntity(id))
            .filter((e) => e !== null);
        const relationships = [...relIds]
            .map(id => {
            const row = this.db.prepare(`SELECT * FROM relationships WHERE id = ?`).get(id);
            return row ? this.rowToRelationship(row) : null;
        })
            .filter((r) => r !== null);
        return { entities, relationships };
    }
    // ─── Stats ─────────────────────────────────────────────────────
    stats() {
        const entityCount = this.db.prepare(`SELECT COUNT(*) as c FROM entities`).get().c;
        const relCount = this.db.prepare(`SELECT COUNT(*) as c FROM relationships`).get().c;
        const entityTypes = this.db.prepare(`SELECT DISTINCT type FROM entities ORDER BY type`).all()
            .map(r => r.type);
        const relationTypes = this.db.prepare(`SELECT DISTINCT relation FROM relationships ORDER BY relation`).all()
            .map(r => r.relation);
        const oldest = this.db.prepare(`SELECT MIN(created_at) as t FROM entities`).get();
        const newest = this.db.prepare(`SELECT MAX(updated_at) as t FROM entities`).get();
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
            properties: JSON.parse(row.properties || '{}'),
            created_at: row.created_at,
            updated_at: row.updated_at,
            source: row.source ?? undefined,
            confidence: row.confidence,
        };
    }
    rowToRelationship(row) {
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
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=engine.js.map