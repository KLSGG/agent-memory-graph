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
export async function generateEmbedding(
  text: string,
  model = 'text-embedding-3-small'
): Promise<number[]> {
  const { default: OpenAI } = await import('openai') as any;
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-local',
    baseURL: process.env.OPENAI_BASE_URL || 'http://127.0.0.1:20128/v1',
  });

  const response = await client.embeddings.create({
    model,
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Store embedding for an entity.
 */
export function storeEmbedding(
  db: Database.Database,
  entityId: string,
  vector: number[],
  model: string
): void {
  const id = `emb-${entityId}`;
  
  // Upsert: replace if exists
  db.prepare(`
    INSERT OR REPLACE INTO embeddings (id, entity_id, vector, model, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(id, entityId, JSON.stringify(vector), model);
}

/**
 * Get embedding for an entity (if exists).
 */
export function getEmbedding(db: Database.Database, entityId: string): number[] | null {
  const row = db.prepare(`SELECT vector FROM embeddings WHERE entity_id = ?`).get(entityId) as any;
  if (!row) return null;
  return JSON.parse(row.vector);
}

/**
 * Semantic search: find entities most similar to query text.
 * Generates embedding for query, then compares against all stored embeddings.
 */
export async function semanticSearch(
  db: Database.Database,
  query: string,
  options: { limit?: number; minSimilarity?: number; model?: string } = {}
): Promise<SemanticSearchResult[]> {
  const { limit = 10, minSimilarity = 0.3, model = 'text-embedding-3-small' } = options;
  
  // Generate query embedding
  let queryVector: number[];
  try {
    queryVector = await generateEmbedding(query, model);
  } catch (err) {
    // If embedding fails (no API, model not available), return empty
    console.warn('[memory-graph] Embedding generation failed:', (err as Error).message);
    return [];
  }
  
  // Get all stored embeddings
  const rows = db.prepare(`
    SELECT e.id as entity_id, e.name as entity_name, e.type as entity_type, emb.vector
    FROM embeddings emb
    JOIN entities e ON emb.entity_id = e.id
    WHERE e.lifecycle = 'active' OR e.lifecycle IS NULL
  `).all() as any[];
  
  if (rows.length === 0) return [];
  
  // Compute similarities
  const results: SemanticSearchResult[] = [];
  for (const row of rows) {
    const storedVector = JSON.parse(row.vector);
    const similarity = cosineSimilarity(queryVector, storedVector);
    if (similarity >= minSimilarity) {
      results.push({
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_type: row.entity_type,
        similarity,
      });
    }
  }
  
  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

/**
 * Batch embed all entities that don't have embeddings yet.
 * Call this periodically or after bulk ingestion.
 */
export async function embedMissingEntities(
  db: Database.Database,
  options: { model?: string; batchSize?: number } = {}
): Promise<number> {
  const { model = 'text-embedding-3-small', batchSize = 20 } = options;
  
  // Find entities without embeddings
  const missing = db.prepare(`
    SELECT e.id, e.name, e.type, e.properties
    FROM entities e
    LEFT JOIN embeddings emb ON e.id = emb.entity_id
    WHERE emb.id IS NULL AND (e.lifecycle = 'active' OR e.lifecycle IS NULL)
    LIMIT ?
  `).all(batchSize) as any[];
  
  if (missing.length === 0) return 0;
  
  let embedded = 0;
  for (const entity of missing) {
    try {
      // Build text representation for embedding
      const props = JSON.parse(entity.properties || '{}');
      const propsText = Object.entries(props)
        .filter(([_, v]) => v && typeof v === 'string')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      
      const text = `${entity.name} (${entity.type})${propsText ? '. ' + propsText : ''}`;
      
      const vector = await generateEmbedding(text, model);
      storeEmbedding(db, entity.id, vector, model);
      embedded++;
    } catch (err) {
      console.warn(`[memory-graph] Failed to embed entity ${entity.name}:`, (err as Error).message);
      break; // Stop on first failure (likely API issue)
    }
  }
  
  return embedded;
}
