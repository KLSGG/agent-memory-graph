# Changelog

All notable changes to `agent-memory-graph` will be documented in this file.

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
