/**
 * Local rule-based entity/relationship extraction.
 * Zero LLM cost. Uses pattern matching, heuristics, and NER-like rules.
 * Inspired by ICM's approach: extract facts from text using grammar patterns.
 */
import { normalizeRelation } from './relations.js';
// ─── Entity Detection Patterns ─────────────────────────────────
// Capitalized multi-word names (likely proper nouns / entities)
const PROPER_NOUN_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
// Known entity type indicators
const TYPE_INDICATORS = {
    Person: [
        /\b(CEO|CTO|founder|developer|engineer|author|creator|researcher|professor|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:is|was)\s+(?:a|an|the)\s+(?:developer|engineer|founder|CEO|CTO|researcher|author)/gi,
    ],
    Company: [
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc|Corp|LLC|Ltd|GmbH|Co)\b/gi,
        /(?:at|from|joined|left)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    ],
    Project: [
        /\b([a-z][\w-]*(?:\.[\w-]+)*)\s+(?:v\d|version|@\d)/gi,
        /(?:built|created|launched|released|published)\s+([A-Z][\w-]+)(?:\s|\.|,|$)/gi,
    ],
    Tool: [
        /(?:using|uses|with|via)\s+([A-Z][\w-]+(?:\s+[A-Z][\w-]+)*)/gi,
    ],
    Location: [
        /(?:in|at|from|based in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*(?:,|\.|$)/gi,
    ],
};
const RELATION_PATTERNS = [
    // X works at/for Y
    { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:works?\s+(?:at|for)|joined|is\s+at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, relation: 'WORKS_AT', fromGroup: 1, toGroup: 2, fromType: 'Person', toType: 'Company' },
    // X created/built/developed Y
    { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:created|built|developed|authored|wrote|designed|founded)\s+([A-Z][\w][\w-]*)(?:\s|\.|,|$)/gi, relation: 'BUILDS', fromGroup: 1, toGroup: 2, fromType: 'Person', toType: 'Project' },
    // X uses Y (stop at conjunctions/punctuation)
    { pattern: /([A-Z][\w-]+)\s+(?:uses|runs\s+on|powered\s+by|built\s+with|depends\s+on)\s+([A-Z][\w-]+)/gi, relation: 'USES', fromGroup: 1, toGroup: 2 },
    // X is part of Y
    { pattern: /([A-Z][\w]+(?:\s+[\w]+)*)\s+(?:is\s+part\s+of|belongs\s+to|included\s+in)\s+([A-Z][\w]+(?:\s+[\w]+)*)/gi, relation: 'PART_OF', fromGroup: 1, toGroup: 2 },
    // X published/deployed to Y
    { pattern: /([A-Z][\w-]+)\s+(?:published|deployed|pushed)\s+(?:to|on)\s+([A-Z][\w]+)/gi, relation: 'PUBLISHED_TO', fromGroup: 1, toGroup: 2 },
    // X located/based in Y
    { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:is\s+)?(?:located|based|headquartered)\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, relation: 'LOCATED_IN', fromGroup: 1, toGroup: 2, fromType: 'Company', toType: 'Location' },
    // X leads/manages Y
    { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:leads|manages|heads|directs)\s+([A-Z][\w]+(?:\s+[\w]+)*)/gi, relation: 'LEADS', fromGroup: 1, toGroup: 2, fromType: 'Person' },
    // X supports/integrates with Y
    { pattern: /([A-Z][\w-]+)\s+(?:supports|integrates\s+with|compatible\s+with)\s+([A-Z][\w-]+(?:\s+[\w-]+)*)/gi, relation: 'SUPPORTS', fromGroup: 1, toGroup: 2 },
    // X replaces/alternative to Y
    { pattern: /([A-Z][\w-]+)\s+(?:replaces|is\s+an?\s+alternative\s+to)\s+([A-Z][\w-]+)/gi, relation: 'REPLACES', fromGroup: 1, toGroup: 2 },
    // X invested in / funded Y
    { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:invested\s+in|funded|backed)\s+([A-Z][\w]+(?:\s+[\w]+)*)/gi, relation: 'INVESTED_IN', fromGroup: 1, toGroup: 2, fromType: 'Company', toType: 'Project' },
    // X owns Y
    { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:owns|acquired)\s+([A-Z][\w]+(?:\s+[\w]+)*)/gi, relation: 'OWNS', fromGroup: 1, toGroup: 2 },
];
// ─── Stop words for entity filtering ────────────────────────────
const STOP_ENTITIES = new Set([
    'The', 'This', 'That', 'These', 'Those', 'Here', 'There',
    'What', 'When', 'Where', 'Which', 'Who', 'How', 'Why',
    'And', 'But', 'For', 'Not', 'All', 'Any', 'Each', 'Every',
    'Some', 'None', 'Other', 'Another', 'Such', 'Much', 'Many',
    'New', 'Old', 'First', 'Last', 'Next', 'Good', 'Bad',
    'True', 'False', 'Yes', 'No', 'OK', 'Done', 'Error',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]);
// ─── Main Extraction Function ───────────────────────────────────
/**
 * Extract entities and relationships from text using rule-based patterns.
 * Zero LLM cost. Returns lower confidence than LLM extraction.
 */
export function localExtract(text) {
    const entities = new Map();
    const relationships = [];
    // 1. Extract entities from type indicator patterns
    for (const [type, patterns] of Object.entries(TYPE_INDICATORS)) {
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const name = (match[2] || match[1]).trim();
                if (name.length >= 2 && !STOP_ENTITIES.has(name)) {
                    entities.set(name.toLowerCase(), { name, type, properties: {}, confidence: 0.7 });
                }
            }
        }
    }
    // 2. Extract proper nouns not yet captured
    PROPER_NOUN_RE.lastIndex = 0;
    let match;
    while ((match = PROPER_NOUN_RE.exec(text)) !== null) {
        const name = match[1].trim();
        if (name.length >= 2 && !STOP_ENTITIES.has(name) && !entities.has(name.toLowerCase())) {
            entities.set(name.toLowerCase(), { name, type: 'Unknown', properties: {}, confidence: 0.5 });
        }
    }
    // 3. Extract relationships
    for (const rp of RELATION_PATTERNS) {
        rp.pattern.lastIndex = 0;
        let relMatch;
        while ((relMatch = rp.pattern.exec(text)) !== null) {
            const from = relMatch[rp.fromGroup]?.trim();
            const to = relMatch[rp.toGroup]?.trim();
            if (!from || !to || from === to)
                continue;
            if (STOP_ENTITIES.has(from) || STOP_ENTITIES.has(to))
                continue;
            const normalized = normalizeRelation(rp.relation);
            if (!normalized)
                continue;
            // Ensure entities exist
            if (!entities.has(from.toLowerCase())) {
                entities.set(from.toLowerCase(), { name: from, type: rp.fromType || 'Unknown', properties: {}, confidence: 0.6 });
            }
            if (!entities.has(to.toLowerCase())) {
                entities.set(to.toLowerCase(), { name: to, type: rp.toType || 'Unknown', properties: {}, confidence: 0.6 });
            }
            relationships.push({
                from,
                relation: normalized,
                to,
                fromType: rp.fromType || entities.get(from.toLowerCase())?.type,
                toType: rp.toType || entities.get(to.toLowerCase())?.type,
                confidence: 0.65,
            });
        }
    }
    return {
        entities: Array.from(entities.values()),
        relationships,
    };
}
/**
 * Determine if text is complex enough to warrant LLM extraction.
 * Used in hybrid mode to decide when to call LLM vs use local only.
 */
export function needsLLMExtraction(text, localResult) {
    // Short text with good local results → skip LLM
    if (text.length < 100 && localResult.entities.length > 0)
        return false;
    // Very short text → skip LLM regardless
    if (text.length < 50)
        return false;
    // Long text with few local results → needs LLM
    if (text.length > 200 && localResult.entities.length < 2)
        return true;
    // Complex sentences (multiple clauses) with no relations found → needs LLM
    const clauseCount = (text.match(/[,;:]/g) || []).length;
    if (clauseCount > 3 && localResult.relationships.length === 0)
        return true;
    // Many proper nouns but no relations → needs LLM to find connections
    if (localResult.entities.length > 3 && localResult.relationships.length === 0)
        return true;
    // Default: local is sufficient
    return false;
}
//# sourceMappingURL=local-extractor.js.map