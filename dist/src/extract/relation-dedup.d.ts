/**
 * Relation dedup utility.
 * Normalizes existing relations in the database to canonical forms.
 * Run once to clean up historical data.
 */
import Database from 'better-sqlite3';
export interface DedupResult {
    normalized: number;
    removed: number;
    mergedRelations: {
        from: string;
        to: string;
        count: number;
    }[];
}
/**
 * Normalize all existing relations in the database.
 * - Maps synonyms to canonical forms
 * - Removes vague relations
 * - Merges duplicate relations (same from/to/canonical_relation)
 */
export declare function dedupRelations(db: Database.Database): DedupResult;
//# sourceMappingURL=relation-dedup.d.ts.map