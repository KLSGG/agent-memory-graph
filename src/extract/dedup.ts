import { GraphEngine, type Entity } from '../graph/engine.js';

/**
 * Find potential duplicate entities based on name similarity.
 */
export function findDuplicates(
  engine: GraphEngine,
  threshold = 0.85
): Array<{ entity: Entity; duplicateOf: Entity; similarity: number }> {
  const entities = engine.listEntities({ limit: 10000 });
  const duplicates: Array<{ entity: Entity; duplicateOf: Entity; similarity: number }> = [];
  const processed = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    if (processed.has(entities[i].id)) continue;

    for (let j = i + 1; j < entities.length; j++) {
      if (processed.has(entities[j].id)) continue;

      // Same type check
      if (entities[i].type.toLowerCase() !== entities[j].type.toLowerCase()) continue;

      const sim = nameSimilarity(entities[i].name, entities[j].name);
      if (sim >= threshold) {
        duplicates.push({
          entity: entities[j],
          duplicateOf: entities[i],
          similarity: sim,
        });
        processed.add(entities[j].id);
      }
    }
  }

  return duplicates;
}

/**
 * Merge duplicate entity into target (moves all relationships, then deletes duplicate).
 */
export function mergeEntities(
  engine: GraphEngine,
  keepId: string,
  mergeId: string
): boolean {
  const keep = engine.getEntity(keepId);
  const merge = engine.getEntity(mergeId);
  if (!keep || !merge) return false;

  // Merge properties (keep's properties take priority)
  const mergedProps = { ...merge.properties, ...keep.properties };
  engine.updateEntity(keepId, { properties: mergedProps });

  // Move all relationships from merge → keep
  engine.reassignRelationships(mergeId, keepId);

  // Delete the duplicate
  engine.deleteEntity(mergeId);

  return true;
}

/**
 * Auto-dedup: find and merge entities that are clearly the same.
 * Uses stricter rules than findDuplicates for automatic merging:
 * - Same type
 * - One name contains the other (e.g., "KL" vs "Sếp KL")
 * - Or Levenshtein similarity >= 0.9
 */
export function autoDedup(engine: GraphEngine): number {
  const entities = engine.listEntities({ limit: 10000 });
  let mergeCount = 0;
  const merged = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    if (merged.has(entities[i].id)) continue;

    for (let j = i + 1; j < entities.length; j++) {
      if (merged.has(entities[j].id)) continue;

      // Same type required
      if (entities[i].type.toLowerCase() !== entities[j].type.toLowerCase()) continue;

      const sim = nameSimilarity(entities[i].name, entities[j].name);
      
      // Only auto-merge at very high confidence (0.9+)
      if (sim >= 0.9) {
        // Keep the longer/more descriptive name
        const [keep, remove] = entities[i].name.length >= entities[j].name.length
          ? [entities[i], entities[j]]
          : [entities[j], entities[i]];
        
        mergeEntities(engine, keep.id, remove.id);
        merged.add(remove.id);
        mergeCount++;
      }
    }
  }

  return mergeCount;
}

/**
 * Simple name similarity using normalized Levenshtein distance.
 */
function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();

  if (na === nb) return 1.0;

  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  // Levenshtein distance
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1.0 : 1.0 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
