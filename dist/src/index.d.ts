import { type Entity, type Relationship, type GraphStats } from './graph/engine.js';
import { type Config } from './config/defaults.js';
import { type ExtractionResult } from './extract/extractor.js';
import { type SearchResult } from './search/hybrid.js';
import { type NLQueryResult } from './search/natural-language.js';
import { type ExportFormat } from './sync/export.js';
export interface MemoryGraphOptions {
    /** Path to SQLite database file */
    path?: string;
    /** Path to config file (optional) */
    configPath?: string;
    /** Inline config override (optional) */
    config?: Partial<Config>;
}
/**
 * MemoryGraph — Domain-agnostic knowledge graph for AI agents.
 *
 * Zero-config, local-first, SQLite-powered.
 *
 * @example
 * ```ts
 * import { MemoryGraph } from 'agent-memory-graph';
 *
 * const graph = new MemoryGraph();
 * await graph.ingest("Alice works on Project Atlas using Rust");
 * const answer = await graph.ask("What does Alice work on?");
 * console.log(answer);
 * ```
 */
export declare class MemoryGraph {
    private engine;
    private config;
    private ingestCount;
    private readonly DEDUP_INTERVAL;
    constructor(options?: MemoryGraphOptions);
    /**
     * Ingest text: extract entities and relationships, store in graph.
     */
    ingest(text: string, options?: {
        source?: string;
        sessionId?: string;
    }): Promise<ExtractionResult>;
    /**
     * Ask a natural language question against the graph.
     */
    ask(question: string): Promise<NLQueryResult>;
    /**
     * Search entities by keyword.
     */
    search(query: string, limit?: number): SearchResult[];
    /**
     * Add an entity manually.
     */
    addEntity(name: string, type: string, properties?: Record<string, unknown>): Entity;
    /**
     * Add a relationship manually.
     */
    addRelation(from: string, relation: string, to: string, options?: {
        fromType?: string;
        toType?: string;
    }): Relationship;
    /**
     * Find an entity by name.
     */
    findEntity(name: string, type?: string): Entity | null;
    /**
     * List entities, optionally filtered by type.
     */
    listEntities(options?: {
        type?: string;
        limit?: number;
    }): Entity[];
    /**
     * Delete an entity and its relationships.
     */
    deleteEntity(nameOrId: string): boolean;
    /**
     * Find shortest path between two entities.
     */
    findPath(from: string, to: string, maxHops?: number): {
        path: string[];
        relations: string[];
    } | null;
    /**
     * Get all entities and relationships within N hops of an entity.
     */
    neighborhood(entityName: string, hops?: number): {
        entities: Entity[];
        relationships: Relationship[];
    };
    /**
     * Export graph to a format (json, mermaid, dot, csv).
     */
    export(format: ExportFormat, options?: {
        includeProperties?: boolean;
        maxEntities?: number;
    }): string;
    /**
     * Import from a MEMORY.md file or directory.
     */
    importFrom(path: string): Promise<{
        entities: number;
        relationships: number;
    }>;
    /**
     * Find and optionally merge duplicate entities.
     */
    deduplicate(options?: {
        threshold?: number;
        autoMerge?: boolean;
    }): Array<{
        entity: string;
        duplicateOf: string;
        similarity: number;
    }>;
    /**
     * Get graph statistics.
     */
    stats(): GraphStats;
    /**
     * Close database connection.
     */
    close(): void;
}
export type { Entity, Relationship, GraphStats } from './graph/engine.js';
export type { Config } from './config/schema.js';
export type { ExtractionResult, ExtractedEntity, ExtractedRelation } from './extract/extractor.js';
export type { SearchResult } from './search/hybrid.js';
export type { NLQueryResult } from './search/natural-language.js';
export type { ExportFormat } from './sync/export.js';
//# sourceMappingURL=index.d.ts.map