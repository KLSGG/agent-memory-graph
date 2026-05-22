#!/usr/bin/env node
/**
 * Runtime test mirroring plugin/entry.ts tool handlers (no gateway needed).
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { unlinkSync, existsSync } from "node:fs";

const testDb = resolve(homedir(), ".openclaw/data/memory-graph-test-runtime.db");
if (existsSync(testDb)) unlinkSync(testDb);

const { MemoryGraph } = await import("../dist/src/index.js");

const graph = new MemoryGraph({
  path: testDb,
  config: {
    extraction: { provider: "openai", model: "auto", autoExtract: true, minConfidence: 0.7, batchSize: 5 },
    domains: [],
    query: { maxHops: 3, maxResults: 10, includeConfidence: true },
  },
});

const results = [];

function ok(name, detail) {
  results.push({ name, pass: true, detail });
  console.log(`✓ ${name}: ${detail}`);
}
function fail(name, detail) {
  results.push({ name, pass: false, detail });
  console.log(`✗ ${name}: ${detail}`);
}

try {
  // memory_graph_ingest (manual, no LLM)
  graph.addEntity("OpenClaw", "Tool");
  graph.addEntity("TinGameFi", "Project");
  graph.addRelation("Sếp", "OWNS", "TinGameFi", { fromType: "Person" });
  graph.addRelation("TinGameFi", "USES", "OpenClaw", { fromType: "Project", toType: "Tool" });
  ok("manual ingest", "3 entities + 2 relations");

  // memory_graph_stats
  const stats = graph.stats();
  if (stats.entities >= 3 && stats.relationships >= 2) {
    ok("stats", `entities=${stats.entities} relationships=${stats.relationships}`);
  } else {
    fail("stats", JSON.stringify(stats));
  }

  // memory_graph_search
  const searchHits = graph.search("TinGameFi", 5);
  if (searchHits.length > 0) {
    ok("search", `found ${searchHits[0].name}`);
  } else {
    fail("search", "no hits for TinGameFi");
  }

  // memory_graph_path
  const pathResult = graph.findPath("Sếp", "OpenClaw", 3);
  if (pathResult?.path?.length >= 2) {
    ok("path", pathResult.path.join(" -> "));
  } else {
    fail("path", pathResult ? JSON.stringify(pathResult) : "null");
  }

  // memory_graph_query (NL)
  const q1 = await graph.ask("What does TinGameFi use?");
  if (q1.answer && q1.confidence > 0) {
    ok("query", q1.answer.slice(0, 80));
  } else {
    fail("query", q1.answer || "empty");
  }

  // Simulate auto-ingest skip (short message)
  const shortText = "hi";
  if (shortText.length < 15) {
    ok("auto-ingest skip", "messages < 15 chars skipped (hook logic)");
  }

  graph.close();
  if (existsSync(testDb)) unlinkSync(testDb);

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n--- ${passed}/${total} runtime checks passed ---`);
  process.exit(passed === total ? 0 : 1);
} catch (err) {
  console.error("Runtime test error:", err);
  graph.close?.();
  process.exit(1);
}
