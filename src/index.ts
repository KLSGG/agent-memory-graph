import { GraphEngine, type Entity, type Relationship, type GraphStats } from './graph/engine.js';
import { loadConfig, type Config } from './config/defaults.js';
import { extractFromText, type ExtractionResult } from './extract/extractor.js';
import { hybridSearch, type SearchResult } from './search/hybrid.js';
import { naturalLanguageQuery, type NLQueryResult } from './search/natural-language.js';
import { exportGraph, type ExportFormat } from './sync/export.js';
import { importFromMemoryMd, importFromDirectory } from './sync/memory-md.js';
import { findDuplicates, mergeEntities, autoDedup } from './extract/dedup.js';

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
export class MemoryGraph {
  private engine: GraphEngine;
  private config: Config;
  private ingestCount = 0;
  private readonly DEDUP_INTERVAL = 10; // Run auto-dedup every N ingestions

  constructor(options: MemoryGraphOptions = {}) {
    this.config = loadConfig(options.configPath);

    // Apply inline overrides
    if (options.config) {
      this.config = { ...this.config, ...options.config } as Config;
    }

    const dbPath = options.path ?? this.config.storage.path;
    this.engine = new GraphEngine(dbPath);
  }

  // ─── Core API ──────────────────────────────────────────────────

  /**
   * Ingest text: extract entities and relationships, store in graph.
   */
  async ingest(text: string, options: { source?: string; sessionId?: string } = {}): Promise<ExtractionResult> {
    const result = await extractFromText(text, this.config);

    // Store entities
    for (const entity of result.entities) {
      this.engine.addEntity(entity.name, entity.type, entity.properties ?? {}, {
        source: options.source,
        confidence: entity.confidence,
      });
    }

    // Store relationships
    for (const rel of result.relationships) {
      const props: Record<string, unknown> = {};
      if ((rel as any).when) props.when = (rel as any).when;
      this.engine.addRelation(rel.from, rel.relation, rel.to, {
        source: options.source,
        confidence: rel.confidence,
        fromType: rel.fromType,
        toType: rel.toType,
        properties: props,
      });
    }

    // Log extraction
    this.engine.logExtraction(text, result.entities, result.relationships, options.sessionId);

    // Auto-dedup every N ingestions
    this.ingestCount++;
    if (this.ingestCount % this.DEDUP_INTERVAL === 0) {
      try {
        autoDedup(this.engine);
      } catch (_) { /* non-blocking */ }
    }

    return result;
  }

  /**
   * Ask a natural language question against the graph.
   */
  async ask(question: string): Promise<NLQueryResult> {
    return naturalLanguageQuery(question, this.engine, this.config);
  }

  /**
   * Search entities by keyword.
   */
  search(query: string, limit?: number): SearchResult[] {
    return hybridSearch(this.engine, query, {
      ...this.config,
      query: { ...this.config.query, maxResults: limit ?? this.config.query.maxResults },
    });
  }

  // ─── Entity Management ─────────────────────────────────────────

  /**
   * Add an entity manually.
   */
  addEntity(name: string, type: string, properties: Record<string, unknown> = {}): Entity {
    return this.engine.addEntity(name, type, properties);
  }

  /**
   * Add a relationship manually.
   */
  addRelation(from: string, relation: string, to: string, options?: { fromType?: string; toType?: string }): Relationship {
    return this.engine.addRelation(from, relation, to, options);
  }

  /**
   * Find an entity by name.
   */
  findEntity(name: string, type?: string): Entity | null {
    return this.engine.findEntityByName(name, type);
  }

  /**
   * List entities, optionally filtered by type.
   */
  listEntities(options?: { type?: string; limit?: number }): Entity[] {
    return this.engine.listEntities(options);
  }

  /**
   * Delete an entity and its relationships.
   */
  deleteEntity(nameOrId: string): boolean {
    const entity = this.engine.getEntity(nameOrId) ?? this.engine.findEntityByName(nameOrId);
    if (!entity) return false;
    return this.engine.deleteEntity(entity.id);
  }

  // ─── Graph Operations ──────────────────────────────────────────

  /**
   * Find shortest path between two entities.
   */
  findPath(from: string, to: string, maxHops?: number): { path: string[]; relations: string[] } | null {
    return this.engine.findPath(from, to, maxHops ?? this.config.query.maxHops);
  }

  /**
   * Get all entities and relationships within N hops of an entity.
   */
  neighborhood(entityName: string, hops = 1): { entities: Entity[]; relationships: Relationship[] } {
    return this.engine.getNeighborhood(entityName, hops);
  }

  // ─── Import / Export ───────────────────────────────────────────

  /**
   * Export graph to a format (json, mermaid, dot, csv).
   */
  export(format: ExportFormat, options?: { includeProperties?: boolean; maxEntities?: number }): string {
    return exportGraph(this.engine, { format, ...options });
  }

  /**
   * Import from a MEMORY.md file or directory.
   */
  async importFrom(path: string): Promise<{ entities: number; relationships: number }> {
    const { statSync } = await import('node:fs');
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
  deduplicate(options?: { threshold?: number; autoMerge?: boolean }): Array<{ entity: string; duplicateOf: string; similarity: number }> {
    const threshold = options?.threshold ?? this.config.deduplication.similarityThreshold;
    const duplicates = findDuplicates(this.engine, threshold);

    if (options?.autoMerge) {
      for (const dup of duplicates) {
        mergeEntities(this.engine, dup.duplicateOf.id, dup.entity.id);
      }
    }

    return duplicates.map(d => ({
      entity: d.entity.name,
      duplicateOf: d.duplicateOf.name,
      similarity: d.similarity,
    }));
  }

  /**
   * Get graph statistics.
   */
  stats(): GraphStats {
    return this.engine.stats();
  }

  /**
   * Get the underlying graph engine (for advanced temporal/lifecycle operations).
   */
  getEngine(): GraphEngine {
    return this.engine;
  }

  /**
   * Get raw database handle (for semantic search and advanced queries).
   */
  getDb(): any {
    return (this.engine as any).db;
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.engine.close();
  }
}

// Re-exports
export type { Entity, Relationship, GraphStats } from './graph/engine.js';
export type { Config } from './config/schema.js';
export type { ExtractionResult, ExtractedEntity, ExtractedRelation } from './extract/extractor.js';
export type { SearchResult } from './search/hybrid.js';
export type { NLQueryResult } from './search/natural-language.js';
export type { ExportFormat } from './sync/export.js';
