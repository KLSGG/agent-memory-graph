/**
 * Semantic/vector search for the knowledge graph.
 * Uses OpenAI-compatible embeddings API (works with local 9router, OpenAI, etc.)
 * Stores embeddings in SQLite as JSON arrays, computes cosine similarity in JS.
 * Lightweight approach — no external vector DB needed.
 */
import Database from 'better-sqlite3';
export interface EmbeddingRecord {
    id: string;
    entity_id: string;
    vector: number[];
    model: string;
    created_at: string;
}
export interface SemanticSearchResult {
    entity_id: string;
    entity_name: string;
    entity_type: string;
    similarity: number;
}
/**
 * Generate embedding for text using OpenAI-compatible API.
 */
export declare function generateEmbedding(text: string, model?: string): Promise<number[]>;
/**
 * Cosine similarity between two vectors.
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Store embedding for an entity.
 */
export declare function storeEmbedding(db: Database.Database, entityId: string, vector: number[], model: string): void;
/**
 * Get embedding for an entity (if exists).
 */
export declare function getEmbedding(db: Database.Database, entityId: string): number[] | null;
/**
 * Semantic search: find entities most similar to query text.
 * Generates embedding for query, then compares against all stored embeddings.
 */
export declare function semanticSearch(db: Database.Database, query: string, options?: {
    limit?: number;
    minSimilarity?: number;
    model?: string;
}): Promise<SemanticSearchResult[]>;
/**
 * Batch embed all entities that don't have embeddings yet.
 * Call this periodically or after bulk ingestion.
 */
export declare function embedMissingEntities(db: Database.Database, options?: {
    model?: string;
    batchSize?: number;
}): Promise<number>;
//# sourceMappingURL=semantic.d.ts.map