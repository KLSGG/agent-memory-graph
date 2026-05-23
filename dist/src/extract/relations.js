/**
 * Relation normalization and validation.
 * Inspired by Thoth's approach: reject vague relations, normalize synonyms.
 */
// Vague/meaningless relations that should be rejected
const VAGUE_RELATIONS = new Set([
    'RELATED_TO',
    'ASSOCIATED_WITH',
    'CONNECTED_TO',
    'LINKED_TO',
    'IS',
    'IS_NOT',
    'HAS',
    'INVOLVES',
    'AFFECTS',
    'INTERACTS_WITH',
    'CORRESPONDS_TO',
    'PERTAINS_TO',
    'BELONGS_TO',
    'REFERS_TO',
    'DEALS_WITH',
    'CONCERNS',
]);
// Canonical relation mappings (synonym → canonical)
const RELATION_SYNONYMS = {
    // Employment
    'EMPLOYED_BY': 'WORKS_AT',
    'EMPLOYED_AT': 'WORKS_AT',
    'WORKS_FOR': 'WORKS_AT',
    'HIRED_BY': 'WORKS_AT',
    'JOINED': 'WORKS_AT',
    'WORKED_FOR': 'PREVIOUSLY_WORKED_AT',
    'WORKED_AT': 'PREVIOUSLY_WORKED_AT',
    'LEFT': 'PREVIOUSLY_WORKED_AT',
    // Creation/Building
    'CREATED': 'BUILDS',
    'BUILT': 'BUILDS',
    'DEVELOPED': 'BUILDS',
    'DEVELOPING': 'BUILDS',
    'AUTHORED': 'BUILDS',
    'WROTE': 'BUILDS',
    'MADE': 'BUILDS',
    'DESIGNED': 'BUILDS',
    // Ownership
    'OWNS': 'OWNS',
    'FOUNDED': 'FOUNDED',
    'CO_FOUNDED': 'FOUNDED',
    // Publishing
    'PUBLISHED_AS': 'PUBLISHED',
    'PUBLISHED_ON': 'PUBLISHED_TO',
    'PUBLISHED_TO': 'PUBLISHED_TO',
    'PUSH_TO': 'PUBLISHED_TO',
    'RELEASED': 'PUBLISHED',
    'DEPLOYED': 'PUBLISHED',
    'DEPLOYS_TO': 'PUBLISHED_TO',
    // Usage
    'UTILIZES': 'USES',
    'EMPLOYS': 'USES',
    'LEVERAGES': 'USES',
    'RUNS_ON': 'USES',
    'POWERED_BY': 'USES',
    'BUILT_WITH': 'USES',
    'DEPENDS_ON': 'USES',
    // Collaboration
    'COLLABORATES_ON': 'WORKS_WITH',
    'COLLABORATES_WITH': 'WORKS_WITH',
    'PARTNERS_WITH': 'WORKS_WITH',
    'COOPERATES_WITH': 'WORKS_WITH',
    // Part-of
    'PART_OF': 'PART_OF',
    'COMPONENT_OF': 'PART_OF',
    'INCLUDED_IN': 'PART_OF',
    'SUBSET_OF': 'PART_OF',
    'CONTAINS': 'CONTAINS',
    'INCLUDES': 'CONTAINS',
    'INCLUDES_FEATURE': 'CONTAINS',
    'HAS_SUBSYSTEM': 'CONTAINS',
    // Support
    'SUPPORTS': 'SUPPORTS',
    'COMPATIBLE_WITH': 'SUPPORTS',
    'INTEGRATES_WITH': 'SUPPORTS',
    'PLUGIN_FOR': 'SUPPORTS',
    // Testing
    'TESTED': 'TESTS',
    'TESTED_BY': 'TESTS',
    'TESTED_WITH': 'TESTS',
    'TEST_WITH': 'TESTS',
    'TESTS_MEMORY_OF': 'TESTS',
    'VERIFIED': 'TESTS',
    'VERIFIES': 'TESTS',
    // Fixing
    'FIXED': 'FIXES',
    'FIXED_IN': 'FIXES',
    'RESOLVES': 'FIXES',
    'MODIFIED_TO_FIX': 'FIXES',
    // Location
    'LOCATED_IN': 'LOCATED_IN',
    'BASED_IN': 'LOCATED_IN',
    'HEADQUARTERED_IN': 'LOCATED_IN',
    // Leadership
    'LEADS': 'LEADS',
    'MANAGES': 'LEADS',
    'HEADS': 'LEADS',
    'DIRECTS': 'LEADS',
    // Investment
    'INVESTED_IN': 'INVESTED_IN',
    'FUNDED': 'INVESTED_IN',
    'BACKED_BY': 'INVESTED_IN',
    // Specialization
    'SPECIALIZED_IN': 'SPECIALIZES_IN',
    'SPECIALIZES_IN': 'SPECIALIZES_IN',
    'EXPERT_IN': 'SPECIALIZES_IN',
    'EXPERIENCED_WITH': 'SPECIALIZES_IN',
    // Migration
    'MIGRATING_FROM': 'MIGRATING_FROM',
    'MIGRATING_TO': 'MIGRATING_TO',
    'REPLACES': 'REPLACES',
    'ALTERNATIVE_TO': 'ALTERNATIVE_TO',
};
/**
 * Normalize a relation type to its canonical form.
 * Returns null if the relation is too vague to be useful.
 */
export function normalizeRelation(relation) {
    // Uppercase + underscore normalize
    const normalized = relation.trim().toUpperCase().replace(/[\s-]+/g, '_');
    // Reject vague relations
    if (VAGUE_RELATIONS.has(normalized)) {
        return null;
    }
    // Map to canonical form if synonym exists
    return RELATION_SYNONYMS[normalized] || normalized;
}
/**
 * Check if a relation is too vague to store.
 */
export function isVagueRelation(relation) {
    const normalized = relation.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return VAGUE_RELATIONS.has(normalized);
}
/**
 * Get the canonical form of a relation (without rejecting vague ones).
 */
export function getCanonicalRelation(relation) {
    const normalized = relation.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return RELATION_SYNONYMS[normalized] || normalized;
}
//# sourceMappingURL=relations.js.map