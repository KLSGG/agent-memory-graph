function findDuplicates(engine, threshold = 0.85) {
  const entities = engine.listEntities({ limit: 1e4 });
  const duplicates = [];
  const processed = /* @__PURE__ */ new Set();
  for (let i = 0; i < entities.length; i++) {
    if (processed.has(entities[i].id)) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (processed.has(entities[j].id)) continue;
      if (entities[i].type.toLowerCase() !== entities[j].type.toLowerCase()) continue;
      const sim = nameSimilarity(entities[i].name, entities[j].name);
      if (sim >= threshold) {
        duplicates.push({
          entity: entities[j],
          duplicateOf: entities[i],
          similarity: sim
        });
        processed.add(entities[j].id);
      }
    }
  }
  return duplicates;
}
function mergeEntities(engine, keepId, mergeId) {
  const keep = engine.getEntity(keepId);
  const merge = engine.getEntity(mergeId);
  if (!keep || !merge) return false;
  const mergedProps = { ...merge.properties, ...keep.properties };
  engine.updateEntity(keepId, { properties: mergedProps });
  engine.reassignRelationships(mergeId, keepId);
  engine.deleteEntity(mergeId);
  return true;
}
function autoDedup(engine) {
  const entities = engine.listEntities({ limit: 1e4 });
  let mergeCount = 0;
  const merged = /* @__PURE__ */ new Set();
  for (let i = 0; i < entities.length; i++) {
    if (merged.has(entities[i].id)) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (merged.has(entities[j].id)) continue;
      if (entities[i].type.toLowerCase() !== entities[j].type.toLowerCase()) continue;
      const sim = nameSimilarity(entities[i].name, entities[j].name);
      if (sim >= 0.9) {
        const [keep, remove] = entities[i].name.length >= entities[j].name.length ? [entities[i], entities[j]] : [entities[j], entities[i]];
        mergeEntities(engine, keep.id, remove.id);
        merged.add(remove.id);
        mergeCount++;
      }
    }
  }
  return mergeCount;
}
function nameSimilarity(a, b) {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
export {
  autoDedup,
  findDuplicates,
  mergeEntities
};
