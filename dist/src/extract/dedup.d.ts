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
 * Merge duplicate entity into target (moves all relationships).
 */
export declare function mergeEntities(engine: GraphEngine, keepId: string, mergeId: string): boolean;
//# sourceMappingURL=dedup.d.ts.map