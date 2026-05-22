# agent-memory-graph

> Domain-agnostic knowledge graph memory for AI agents. Zero-config, local-first, SQLite-powered.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)

## What is this?

A lightweight knowledge graph that any AI agent can use to remember entities and their relationships. No cloud, no Neo4j, no complex setup — just `npm install` and go.

**Key features:**
- 🧠 **Auto-extraction** — LLM extracts entities and relationships from any text
- 🔍 **Natural language queries** — Ask questions, get graph-powered answers
- 📦 **Single SQLite file** — Zero external dependencies, fully portable
- 🌐 **Domain-agnostic** — Works for any topic: code, crypto, research, CRM, notes
- ⚡ **Zero-config start** — Works out of the box, customize when you need to
- 🔄 **Import existing memory** — Sync from MEMORY.md, notes, or any markdown
- 📊 **Visualize** — Export as Mermaid, DOT, JSON, or CSV

## Quick Start

```bash
# Install
npm install agent-memory-graph

# Or use globally
npm install -g agent-memory-graph
```

### As a library

```typescript
import { MemoryGraph } from 'agent-memory-graph';

const graph = new MemoryGraph();

// Ingest text — entities and relationships are auto-extracted
await graph.ingest("Alice and Bob are building Project Atlas using Rust and PostgreSQL");

// Ask questions
const answer = await graph.ask("What is Project Atlas built with?");
console.log(answer);
// → "Project Atlas uses Rust and PostgreSQL"

// Find connections
const path = graph.findPath("Alice", "PostgreSQL");
console.log(path);
// → Alice -[WORKS_ON]-> Project Atlas -[USES]-> PostgreSQL

// Export as Mermaid diagram
console.log(graph.export('mermaid'));

graph.close();
```

### As a CLI

```bash
# Extract from text
memory-graph ingest "I started learning Rust for the new backend service"

# Ask questions
memory-graph ask "What am I learning?"

# Search
memory-graph search "Rust"

# Add manually
memory-graph add entity "Docker" Tool
memory-graph add relation "Backend Service" DEPLOYED_WITH "Docker"

# Visualize
memory-graph visualize --format mermaid

# Import existing notes
memory-graph sync --source ./MEMORY.md

# Stats
memory-graph stats
```

### As an OpenClaw skill

Place this in your OpenClaw workspace skills directory. The agent will automatically use it when:
- You mention entities in conversation
- You ask relationship questions
- You want to visualize your knowledge graph

### As an OpenClaw Plugin

Install as a plugin for automatic conversation ingestion:

```bash
# Install the plugin
openclaw plugins install agent-memory-graph --dangerously-force-unsafe-install

# Restart gateway to load
openclaw gateway restart
```

Once installed, the plugin:
- **Auto-ingests** every inbound message (>20 chars) into the knowledge graph
- **Registers 5 tools** the agent can call: `memory_graph_ingest`, `memory_graph_search`, `memory_graph_query`, `memory_graph_path`, `memory_graph_stats`
- **Persists** all data in `~/.openclaw/data/memory-graph.db` (survives /reset and /new)

Plugin config in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "memory-graph": {
        "enabled": true,
        "config": {
          "autoIngest": true,
          "extractionModel": "gpt-4o-mini",
          "dbPath": "~/.openclaw/data/memory-graph.db",
          "maxHops": 3,
          "minConfidence": 0.7
        }
      }
    }
  }
}
```

Set `autoIngest: false` to disable the hook and only use manual tool calls.

## Configuration

Works with zero configuration. Optionally create `config/graph.config.json`:

```json
{
  "storage": {
    "path": "./memory-graph.db"
  },
  "extraction": {
    "provider": "auto",
    "model": "auto",
    "autoExtract": true,
    "minConfidence": 0.7
  },
  "domains": [
    {
      "name": "my-domain",
      "entityHints": ["Person", "Project", "Tool"],
      "relationHints": ["WORKS_ON", "USES", "OWNS"]
    }
  ],
  "query": {
    "maxHops": 3,
    "maxResults": 10
  }
}
```

### LLM Provider

The extraction engine needs an LLM. Supports any OpenAI-compatible API.

**Environment variables:**

| Variable | Description | Default |
|----------|-------------|--------|
| `OPENAI_API_KEY` | API key for your LLM provider | `sk-local` (for local proxies) |
| `OPENAI_BASE_URL` | Base URL for OpenAI-compatible API | `http://127.0.0.1:20128/v1` |
| `MEMORY_GRAPH_API_KEY` | Override API key (takes priority if OPENAI_API_KEY not set) | — |
| `MEMORY_GRAPH_BASE_URL` | Override base URL (takes priority if OPENAI_BASE_URL not set) | — |
| `MEMORY_GRAPH_MODEL` | Override extraction model | `gpt-4o-mini` |

**Examples:**

```bash
# OpenAI directly
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"

# Anthropic via OpenAI-compatible proxy (e.g., LiteLLM, 9router)
export OPENAI_API_KEY="sk-local"
export OPENAI_BASE_URL="http://127.0.0.1:4000/v1"
export MEMORY_GRAPH_MODEL="claude-3-5-haiku-20241022"

# Ollama (local, free)
export OPENAI_API_KEY="ollama"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export MEMORY_GRAPH_MODEL="llama3.1"
```

Provider is auto-detected via the OpenAI SDK. No LLM needed for manual operations (add, search, path, stats).

### Domain Hints

Optional hints improve extraction accuracy for your specific use case:

```json
{
  "domains": [
    {
      "name": "software",
      "entityHints": ["Person", "Repository", "Language", "Framework", "Service", "Database"],
      "relationHints": ["MAINTAINS", "USES", "DEPENDS_ON", "DEPLOYS_TO", "WRITTEN_IN"]
    }
  ]
}
```

Without domains, the LLM auto-detects entity types from context.

## API Reference

### `MemoryGraph`

```typescript
new MemoryGraph(options?: { path?: string; configPath?: string; config?: Partial<Config> })
```

#### Core Methods

| Method | Description |
|--------|-------------|
| `ingest(text, options?)` | Extract and store entities/relationships from text |
| `ask(question)` | Natural language query against the graph |
| `search(query, limit?)` | Search entities by keyword |

#### Entity Management

| Method | Description |
|--------|-------------|
| `addEntity(name, type, properties?)` | Add entity manually |
| `addRelation(from, relation, to)` | Add relationship manually |
| `findEntity(name, type?)` | Find entity by name |
| `listEntities(options?)` | List entities (filter by type) |
| `deleteEntity(nameOrId)` | Delete entity and its relationships |

#### Graph Operations

| Method | Description |
|--------|-------------|
| `findPath(from, to, maxHops?)` | Shortest path between entities |
| `neighborhood(name, hops?)` | All entities within N hops |

#### Import / Export

| Method | Description |
|--------|-------------|
| `export(format)` | Export graph (json, mermaid, dot, csv) |
| `importFrom(path)` | Import from file or directory |

#### Maintenance

| Method | Description |
|--------|-------------|
| `deduplicate(options?)` | Find/merge duplicate entities |
| `stats()` | Graph statistics |
| `close()` | Close database connection |

## Use Case Examples

### Software Development
Track projects, team members, tech stack, and dependencies.

### Personal CRM
Remember people, companies, interactions, and context.

### Research Notes
Connect papers, topics, authors, and findings.

### Crypto / DeFi
Track tokens, wallets, protocols, and positions.

### Content Creation
Map topics, articles, keywords, and publishing platforms.

See `examples/` for detailed walkthroughs.

## Architecture

```
┌─────────────────────────────────────────┐
│            MemoryGraph API              │
├─────────────────────────────────────────┤
│  Ingest  │  Query  │  Search  │ Export │
├──────────┼─────────┼──────────┼────────┤
│ Extractor│ NL Query│  Hybrid  │ Mermaid│
│ (LLM)   │ Engine  │  Search  │ JSON   │
├──────────┴─────────┴──────────┴────────┤
│           GraphEngine (SQLite)          │
│  Entities │ Relationships │ FTS5 Index │
└─────────────────────────────────────────┘
```

- **SQLite** — Single file, WAL mode, FTS5 full-text search
- **LLM extraction** — Any provider (OpenAI, Anthropic, Ollama)
- **Graph traversal** — BFS pathfinding, neighborhood queries
- **Deduplication** — Levenshtein-based entity merging

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development
git clone https://github.com/openclaw/agent-memory-graph
cd agent-memory-graph
npm install
npm run dev    # Watch mode
npm test       # Run tests
```

## License

[MIT](LICENSE)
