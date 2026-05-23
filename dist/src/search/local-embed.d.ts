/**
 * Local embedding fallback — TF-IDF inspired vector generation.
 * No external API needed. Runs pure JS in-process.
 *
 * Approach: character n-gram hashing to fixed-size vector.
 * Not as good as transformer embeddings but WAY better than keyword-only search.
 * Captures subword similarity (e.g., "Bitcoin" ≈ "blockchain" via shared n-grams).
 */
/**
 * Generate a local embedding vector from text.
 * Uses character trigram hashing + TF normalization.
 * Deterministic: same text always produces same vector.
 */
export declare function localEmbed(text: string): number[];
/**
 * Cosine similarity between two vectors.
 */
export declare function localCosineSimilarity(a: number[], b: number[]): number;
export declare const LOCAL_MODEL_NAME = "local-ngram-256d";
export declare const LOCAL_VECTOR_DIM = 256;
//# sourceMappingURL=local-embed.d.ts.map