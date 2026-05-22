import { GraphEngine, type Entity } from '../graph/engine.js';
/**
 * Find potential duplicate entities based on name similarity.
 */
export declare function findDuplicates(engine: GraphEngine, threshold?: number): Array<{
    entity: Entity;
    duplicateOf: Entity;
    similarity: number;
}>;
/**
 * Merge duplicate entity into target (moves all relationships, then deletes duplicate).
 */
export declare function mergeEntities(engine: GraphEngine, keepId: string, mergeId: string): boolean;
/**
 * Auto-dedup: find and merge entities that are clearly the same.
 * Uses stricter rules than findDuplicates for automatic merging:
 * - Same type
 * - One name contains the other (e.g., "KL" vs "Sếp KL")
 * - Or Levenshtein similarity >= 0.9
 */
export declare function autoDedup(engine: GraphEngine): number;
//# sourceMappingURL=dedup.d.ts.map