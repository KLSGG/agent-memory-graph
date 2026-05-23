/**
 * Relation dedup utility.
 * Normalizes existing relations in the database to canonical forms.
 * Run once to clean up historical data.
 */
import { getCanonicalRelation, isVagueRelation } from '../extract/relations.js';
/**
 * Normalize all existing relations in the database.
 * - Maps synonyms to canonical forms
 * - Removes vague relations
 * - Merges duplicate relations (same from/to/canonical_relation)
 */
export function dedupRelations(db) {
    const result = { normalized: 0, removed: 0, mergedRelations: [] };
    // Get all relationships
    const allRels = db.prepare(`SELECT * FROM relationships`).all();
    const now = new Date().toISOString();
    const toDelete = [];
    const toUpdate = [];
    // Group by from_id + to_id + canonical_relation to detect duplicates
    const groups = new Map();
    for (const rel of allRels) {
        const canonical = getCanonicalRelation(rel.relation);
        // Mark vague for deletion
        if (isVagueRelation(rel.relation)) {
            toDelete.push(rel.id);
            result.removed++;
            continue;
        }
        // If relation changed after normalization, mark for update
        if (canonical !== rel.relation) {
            toUpdate.push({ id: rel.id, relation: canonical });
            result.normalized++;
        }
        // Group for dedup
        const key = `${rel.from_id}|${rel.to_id}|${canonical}`;
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push({ ...rel, canonical });
    }
    // Delete vague relations
    if (toDelete.length > 0) {
        const deleteStmt = db.prepare(`DELETE FROM relationships WHERE id = ?`);
        for (const id of toDelete) {
            deleteStmt.run(id);
        }
    }
    // Update normalized relations
    if (toUpdate.length > 0) {
        const updateStmt = db.prepare(`UPDATE relationships SET relation = ?, updated_at = ? WHERE id = ?`);
        for (const { id, relation } of toUpdate) {
            updateStmt.run(relation, now, id);
        }
    }
    // Merge duplicates (keep highest confidence, delete rest)
    for (const [key, rels] of groups) {
        if (rels.length <= 1)
            continue;
        // Sort by confidence DESC, then updated_at DESC
        rels.sort((a, b) => {
            if (b.confidence !== a.confidence)
                return b.confidence - a.confidence;
            return b.updated_at > a.updated_at ? 1 : -1;
        });
        // Keep first (best), delete rest
        const keep = rels[0];
        const duplicates = rels.slice(1);
        for (const dup of duplicates) {
            db.prepare(`DELETE FROM relationships WHERE id = ?`).run(dup.id);
            result.removed++;
        }
        // Boost confidence of kept relation
        const boostedConfidence = Math.min(1.0, keep.confidence + (duplicates.length * 0.05));
        db.prepare(`UPDATE relationships SET confidence = ?, updated_at = ? WHERE id = ?`)
            .run(boostedConfidence, now, keep.id);
        result.mergedRelations.push({
            from: key.split('|')[0],
            to: key.split('|')[1],
            count: duplicates.length,
        });
    }
    return result;
}
//# sourceMappingURL=relation-dedup.js.map