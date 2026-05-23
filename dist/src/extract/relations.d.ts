/**
 * Relation normalization and validation.
 * Inspired by Thoth's approach: reject vague relations, normalize synonyms.
 */
/**
 * Normalize a relation type to its canonical form.
 * Returns null if the relation is too vague to be useful.
 */
export declare function normalizeRelation(relation: string): string | null;
/**
 * Check if a relation is too vague to store.
 */
export declare function isVagueRelation(relation: string): boolean;
/**
 * Get the canonical form of a relation (without rejecting vague ones).
 */
export declare function getCanonicalRelation(relation: string): string;
//# sourceMappingURL=relations.d.ts.map