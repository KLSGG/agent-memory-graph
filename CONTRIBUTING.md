# Contributing to agent-memory-graph

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/openclaw/agent-memory-graph
cd agent-memory-graph
npm install
npm run dev    # TypeScript watch mode
npm test       # Run tests
```

## Project Structure

```
src/
├── index.ts              # Main MemoryGraph class and public API
├── config/               # Configuration loading and validation
├── graph/                # SQLite graph engine (CRUD, traversal)
├── extract/              # LLM-based entity extraction + dedup
├── search/               # Hybrid search + natural language queries
└── sync/                 # Import/export (MEMORY.md, JSON, Mermaid)

cli/
└── index.ts              # CLI entry point

tests/                    # Vitest test files
examples/                 # Domain-specific usage examples
```

## Guidelines

### Code Style

- TypeScript strict mode
- ESM modules (no CommonJS)
- Explicit types for public APIs
- JSDoc comments on exported functions/classes

### Commits

- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Keep commits focused (one logical change per commit)

### Pull Requests

- Describe what and why (not just how)
- Include tests for new features
- Update README/examples if adding user-facing features
- Ensure `npm test` passes

## Areas for Contribution

### Good First Issues

- Add more NL query patterns in `src/search/natural-language.ts`
- Add new export formats (e.g., Cypher for Neo4j import)
- Improve entity deduplication heuristics
- Add more domain examples

### Larger Features

- Vector similarity search (sqlite-vec integration)
- Temporal queries ("What was true last week?")
- Graph diff (compare snapshots over time)
- Web UI for visualization
- MCP server integration
- Batch ingestion with progress reporting

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/graph.test.ts

# Watch mode
npm run test:watch
```

Tests use an in-memory SQLite database (`:memory:`) for speed.

## Questions?

Open an issue on GitHub or reach out in the OpenClaw community.
