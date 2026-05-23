/**
 * Local embedding fallback — TF-IDF inspired vector generation.
 * No external API needed. Runs pure JS in-process.
 * 
 * Approach: character n-gram hashing to fixed-size vector.
 * Not as good as transformer embeddings but WAY better than keyword-only search.
 * Captures subword similarity (e.g., "Bitcoin" ≈ "blockchain" via shared n-grams).
 */

const VECTOR_DIM = 256; // Fixed dimension for all vectors

/**
 * Generate a local embedding vector from text.
 * Uses character trigram hashing + TF normalization.
 * Deterministic: same text always produces same vector.
 */
export function localEmbed(text: string): number[] {
  const normalized = text.toLowerCase().trim();
  const vector = new Float64Array(VECTOR_DIM);
  
  if (normalized.length === 0) return Array.from(vector);
  
  // Character trigrams
  const trigrams = new Map<string, number>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    const tri = normalized.slice(i, i + 3);
    trigrams.set(tri, (trigrams.get(tri) || 0) + 1);
  }
  
  // Word unigrams + bigrams for semantic signal
  const words = normalized.split(/\s+/).filter(w => w.length > 1);
  for (const word of words) {
    const hash = simpleHash(word);
    vector[hash % VECTOR_DIM] += 2.0; // Boost word-level signal
  }
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    const hash = simpleHash(bigram);
    vector[hash % VECTOR_DIM] += 1.5;
  }
  
  // Distribute trigram counts into vector via hashing
  for (const [tri, count] of trigrams) {
    const hash = simpleHash(tri);
    const idx = hash % VECTOR_DIM;
    vector[idx] += count;
    // Secondary hash for spread
    const idx2 = (hash * 31 + 7) % VECTOR_DIM;
    vector[idx2] += count * 0.5;
  }
  
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      vector[i] /= norm;
    }
  }
  
  return Array.from(vector);
}

/**
 * Simple deterministic hash function for strings.
 * FNV-1a inspired, returns positive integer.
 */
function simpleHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Cosine similarity between two vectors.
 */
export function localCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export const LOCAL_MODEL_NAME = 'local-ngram-256d';
export const LOCAL_VECTOR_DIM = VECTOR_DIM;
