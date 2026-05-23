# Changelog

All notable changes to `agent-memory-graph` will be documented in this file.

## [0.7.0] - 2026-05-23

### Added
- **Semantic/vector search** (Hermes/MinnsDB-inspired) — embedding-based similarity search for entities. Uses OpenAI-compatible embeddings API. New tools: `memory_graph_semantic_search`, `memory_graph_embed`.
- **MCP server** (agentmemory-inspired) — stdio MCP protocol server so external clients (Claude Code, Cursor, Gemini CLI, etc.) can query the knowledge graph. Binary: `memory-graph-mcp`.
- **Relation dedup tool** — `memory_graph_dedup_relations` normalizes existing relations to canonical forms, removes vague relations, and merges duplicates. Run once after upgrade.
- Embeddings table in schema (v4 migration).
- `getDb()` method on MemoryGraph for direct DB access.

### Changed
- GraphEngine.db is now public (needed for semantic search and dedup access).
- Schema version bumped to 4.

## [0.6.0] - 2026-05-23

### Added
- **Relation normalization** (Thoth-inspired) — synonymous relations are mapped to canonical forms. E.g., `EMPLOYED_BY`, `WORKS_FOR`, `HIRED_BY` all normalize to `WORKS_AT`. Reduces relation type explosion.
- **Vague relation rejection** — meaningless relations like `RELATED_TO`, `ASSOCIATED_WITH`, `IS`, `INVOLVES`, `AFFECTS` are automatically rejected during extraction. Keeps the graph clean and queryable.
- New module `src/extract/relations.ts` with `normalizeRelation()`, `isVagueRelation()`, `getCanonicalRelation()` utilities.

### Changed
- Extraction pipeline now normalizes all relations before storing. Existing graph data is unaffected (normalization applies to new ingestions only).
- Case normalization: `located_in` and `LOCATED_IN` now both resolve to `LOCATED_IN`.

## [0.5.1] - 2026-05-23

### Fixed
- Schema migration v2→v3: SQLite does not support `DEFAULT (expression)` in ALTER TABLE. Changed `valid_from` and `last_accessed` column additions to use no default (value set in application code instead).
- Removed stale `.js` files from `src/` that caused esbuild to bundle old code without `getEngine()` method.
- Static import of MemoryGraph in plugin entry (was dynamic import that esbuild couldn't bundle).

## [0.5.0] - 2026-05-23

### Added
- **Temporal validity** (Graphiti-inspired) — relationships now have `valid_from` and `valid_until` timestamps. Facts are never deleted, only invalidated when superseded by newer information.
- **Fact supersession** — `supersedeRelation()` method and `memory_graph_supersede` tool: update a fact by marking the old one invalid and creating a new one. Full history preserved.
- **Temporal queries** — `getRelationsAtTime()` method and `memory_graph_temporal` tool: query what was true at any point in time.
- **Confidence decay** (agentmemory-inspired) — `applyConfidenceDecay()` method and `memory_graph_decay` tool: older, unaccessed entities/relationships gradually lose confidence. Keeps the graph fresh.
- **Lifecycle states** — entities and relationships now have `lifecycle` field: `active`, `stale`, or `superseded`. Stale items are auto-detected during decay.
- **Access tracking** — `last_accessed` field on entities, updated via `touchEntity()`. Used by decay algorithm to preserve frequently-accessed knowledge.
- **Active-only queries** — `getActiveRelationsFrom()` returns only non-superseded, non-stale relationships. Default behavior for `getRelationsFrom/To` now filters out superseded facts.
- **Enhanced stats** — `memory_graph_stats` now reports active vs superseded relationships and stale entity count.
- Schema migration v2→v3 (automatic, non-destructive).

### Changed
- `getRelationsFrom` / `getRelationsTo` now default to active-only; pass `includeSuperseded=true` for full history.
- `addRelation` now stores `valid_from`, `valid_until`, and `lifecycle` fields.
- Stats include temporal breakdown.

## [0.4.1] - 2026-05-23

### Fixed
- Prompt injection relevance: prioritize Project > Person > Platform > Organization entities, skip Tool/Concept/File/Award types.
- Sort injected entities by priority type + relationship count (most connected = most important).
- Fetch 15 results from search (up from 5) to have more candidates after filtering.
- Fallback logic now fetches 30 recent entities and filters/sorts by priority.

## [0.4.0] - 2026-05-23

### Added
- **Automatic prompt injection** — injects relevant knowledge graph context into every agent prompt via `before_prompt_build` hook. Agents no longer need to manually call graph tools to recall context from previous sessions.
- **Improved agent_end hook** — directly uses messages from the event payload instead of relying on session buffer. Works reliably for both subagent and main sessions.
- New config option `promptInjection` (boolean, default: true) to enable/disable automatic context injection.

### Fixed
- agent_end hook now fires correctly for subagent sessions (removed dependency on `message_received` buffer which doesn't fire for internal messages).
- Lowered minimum message threshold from 5 to 2 meaningful messages for session summary generation.

### Changed
- Session summary logic simplified: uses `event.messages` directly from agent_end instead of maintaining a separate session buffer.

## [0.3.0] - 2026-05-23

### Added
- **Session summary auto-ingestion** — automatically summarizes key actions at end of each session and ingests into the knowledge graph. Uses LLM to extract concrete outcomes (what was built, fixed, published, decided) from the conversation.
- **Assistant message tracking** — tracks both user and assistant messages for richer session summaries via `message_sent` hook.
- **Graceful shutdown flush** — on gateway stop, flushes any pending session summaries before closing.
- New config option `sessionSummary` (boolean, default: true) to enable/disable session summary feature.

### Changed
- `gateway_stop` hook now drains pending session summaries before closing the graph database.

## [0.2.1] - 2026-05-22

### Fixed
- Temporal property parsing now correctly extracts date references from text ("joined in 2024", "last year", etc.)
- Dedup engine strips common title prefixes (Mr/Ms/Dr/etc.) before similarity comparison
- `mention_count` now included in search/query output for ranking visibility

## [0.2.0] - 2026-05-22

### Added
- **Smart filter** — automatically skips commands, tokens, casual chat, URL-only, and short messages during ingestion
- **Temporal extraction** — LLM extracts temporal references ("joined in 2024", "last year") into entity properties
- **Auto-dedup** — merges duplicate entities (e.g. "KL" + "Sếp KL") every 10 ingestions using Levenshtein similarity ≥ 0.9
- **Batch extraction** — groups 5 messages or 15-second window before running extraction (reduces LLM calls)
- **Decay scoring** — older relationships score lower in search results; recent context ranks higher

### Changed
- Ingestion pipeline now runs through smart filter before LLM extraction
- Search results include `mention_count` and `last_seen` metadata

## [0.1.1] - 2026-05-22

### Fixed
- Resolved TypeScript type errors in build pipeline
- Added Node.js version requirements to README (Node 18-22 recommended, Node 24 needs rebuild)
- Added `--dangerously-force-unsafe-install` flag documentation

### Changed
- Rewrote README with full usage guide, demo section, badges, and Mermaid graph diagram

## [0.1.0] - 2026-05-22

### Added
- Initial release
- Core knowledge graph engine (SQLite-powered, local-first)
- 5 OpenClaw tools: `memory_graph_ingest`, `memory_graph_search`, `memory_graph_query`, `memory_graph_path`, `memory_graph_stats`
- Natural language query engine with 12+ rewrite patterns
- Entity extraction via LLM (configurable model)
- Hybrid search (keyword + graph traversal)
- Import from MEMORY.md and directory scanning
- Export graph in multiple formats
