import Database from 'better-sqlite3';
export interface Entity {
    id: string;
    name: string;
    type: string;
    properties: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    source?: string;
    confidence: number;
    mention_count?: number;
    lifecycle?: string;
    last_accessed?: string;
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
    valid_from?: string;
    valid_until?: string | null;
    lifecycle?: string;
}
export interface GraphStats {
    entities: number;
    relationships: number;
    entityTypes: string[];
    relationTypes: string[];
    oldestEntry: string | null;
    newestEntry: string | null;
    activeRelationships?: number;
    supersededRelationships?: number;
    staleEntities?: number;
}
export declare class GraphEngine {
    db: Database.Database;
    constructor(dbPath: string);
    addEntity(name: string, type: string, properties?: Record<string, unknown>, options?: {
        source?: string;
        confidence?: number;
    }): Entity;
    getEntity(id: string): Entity | null;
    findEntityByName(name: string, type?: string): Entity | null;
    updateEntity(id: string, updates: {
        name?: string;
        type?: string;
        properties?: Record<string, unknown>;
        source?: string;
        confidence?: number;
    }): Entity;
    deleteEntity(id: string): boolean;
    reassignRelationships(fromEntityId: string, toEntityId: string): number;
    listEntities(options?: {
        type?: string;
        limit?: number;
        offset?: number;
    }): Entity[];
    addRelation(fromName: string, relation: string, toName: string, options?: {
        properties?: Record<string, unknown>;
        source?: string;
        confidence?: number;
        fromType?: string;
        toType?: string;
        validFrom?: string;
    }): Relationship;
    /**
     * Invalidate a relationship (set valid_until, mark as superseded).
     * Graphiti-inspired: facts are never deleted, only invalidated.
     */
    invalidateRelation(id: string, reason?: string): boolean;
    /**
     * Supersede: invalidate old fact and create new one.
     * E.g., "Alice works at Google" supersedes "Alice works at Meta"
     */
    supersedeRelation(fromName: string, relation: string, oldToName: string, newToName: string, options?: {
        source?: string;
        confidence?: number;
        fromType?: string;
        toType?: string;
    }): {
        invalidated: Relationship | null;
        created: Relationship;
    };
    /**
     * Apply confidence decay to all entities and relationships.
     * Older items lose confidence over time. Called periodically.
     */
    applyConfidenceDecay(decayRate?: number, minConfidence?: number): {
        entitiesDecayed: number;
        relsDecayed: number;
    };
    /**
     * Get relationships valid at a specific point in time.
     * Graphiti-inspired temporal query.
     */
    getRelationsAtTime(entityName: string, atTime: string): (Relationship & {
        to_name: string;
        to_type: string;
    })[];
    /**
     * Get only active (non-invalidated) relations from an entity.
     */
    getActiveRelationsFrom(entityId: string): (Relationship & {
        to_name: string;
        to_type: string;
    })[];
    /**
     * Touch entity (update last_accessed for decay tracking)
     */
    touchEntity(id: string): void;
    getRelationsFrom(entityId: string, includeSuperseded?: boolean): (Relationship & {
        to_name: string;
        to_type: string;
    })[];
    getRelationsTo(entityId: string, includeSuperseded?: boolean): (Relationship & {
        from_name: string;
        from_type: string;
    })[];
    deleteRelation(id: string): boolean;
    searchEntities(query: string, limit?: number): Entity[];
    /**
     * Find path between two entities (BFS, max depth)
     */
    findPath(fromName: string, toName: string, maxHops?: number): {
        path: string[];
        relations: string[];
    } | null;
    /**
     * Get neighborhood of an entity (all connected within N hops)
     */
    getNeighborhood(entityName: string, hops?: number): {
        entities: Entity[];
        relationships: Relationship[];
    };
    stats(): GraphStats;
    logExtraction(rawText: string, entities: any[], relations: any[], sessionId?: string): void;
    private rowToEntity;
    private rowToRelationship;
    /** Close database */
    close(): void;
}
//# sourceMappingURL=engine.d.ts.map