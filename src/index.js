import { GraphEngine } from "./graph/engine.js";
import { loadConfig } from "./config/defaults.js";
import { extractFromText } from "./extract/extractor.js";
import { hybridSearch } from "./search/hybrid.js";
import { naturalLanguageQuery } from "./search/natural-language.js";
import { exportGraph } from "./sync/export.js";
import { importFromMemoryMd, importFromDirectory } from "./sync/memory-md.js";
import { findDuplicates, mergeEntities, autoDedup } from "./extract/dedup.js";
class MemoryGraph {
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
}
export {
  MemoryGraph
};
