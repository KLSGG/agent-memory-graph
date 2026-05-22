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
export declare class GraphEngine {
    private db;
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
    }): Relationship;
    getRelationsFrom(entityId: string): (Relationship & {
        to_name: string;
        to_type: string;
    })[];
    getRelationsTo(entityId: string): (Relationship & {
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