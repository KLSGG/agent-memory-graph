# agent-memory-graph

Build and query knowledge graphs from conversation memory. Zero-config, local-first, domain-agnostic.

## When to use this skill

- User mentions entities (people, projects, tools, places, concepts) in conversation
- User asks relationship questions: "What am I working on?", "Who knows about X?", "How is A connected to B?"
- User asks multi-hop questions requiring traversal: "What tools does my team use?"
- User wants to visualize their knowledge/memory connections
- User wants to import existing memory (MEMORY.md, notes) into a queryable graph

## How it works

1. **Auto-extraction**: When enabled, the skill extracts entities and relationships from conversation text using any LLM provider
2. **Graph storage**: Entities and relationships are stored in a local SQLite database (single file, zero setup)
3. **Natural language query**: User asks questions in plain language → skill translates to graph traversal → returns answer
4. **Visualization**: Export graph as Mermaid diagrams, JSON, or interactive HTML

## Installation

```bash
cd ~/.openclaw/workspace/skills/agent-memory-graph
npm install
npm run build
```

No external database required. Everything runs in a single SQLite file.

## Commands

### Ingest text (extract entities + relationships)

```
memory-graph ingest "Alice and Bob are working on Project Atlas using Rust and PostgreSQL"
```

### Ask a question (natural language → graph query)

```
memory-graph ask "What projects is Alice working on?"
memory-graph ask "What technologies does Project Atlas use?"
memory-graph ask "How is Alice connected to PostgreSQL?"
```

### Search entities

```
memory-graph search "Alice"
memory-graph search --type Person
memory-graph search --relation WORKS_ON
```

### Add entities/relationships manually

```
memory-graph add entity "Docker" Tool
memory-graph add relation "Project Atlas" DEPLOYED_WITH "Docker"
```

### Visualize

```
memory-graph visualize
memory-graph visualize --format mermaid
memory-graph visualize --format json
```

### Import from existing memory

```
memory-graph sync --source ./MEMORY.md
memory-graph sync --source ./notes/
```

### Stats

```
memory-graph stats
```

## Configuration

Optional. The skill works with zero configuration. Create `config/graph.config.json` to customize:

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
  "domains": [],
  "query": {
    "maxHops": 3,
    "maxResults": 10
  }
}
```

### Domain hints (optional)

Add domain hints to improve extraction accuracy for your use case:

```json
{
  "domains": [
    {
      "name": "software",
      "entityHints": ["Person", "Repository", "Language", "Framework", "Service"],
      "relationHints": ["MAINTAINS", "USES", "DEPENDS_ON", "DEPLOYS_TO"]
    }
  ]
}
```

Without domains, the LLM auto-detects entity types from context.

## Integration

### With OpenClaw agents

The skill is triggered when the agent detects:
- Entity mentions in conversation (auto-extract mode)
- Relationship questions from the user
- Explicit memory-graph commands

### With NeuralMemory

If NeuralMemory is available, the skill can sync extracted entities bidirectionally.

### With MEMORY.md

Import existing markdown memory files to bootstrap the graph.

## Examples

See `examples/` for domain-specific usage:
- `basic-usage.md` — Getting started
- `software-project.md` — Track code projects and team
- `personal-crm.md` — Track contacts and interactions
- `research-notes.md` — Connect research topics and papers
- `team-knowledge.md` — Map team expertise and ownership

## Troubleshooting

### No entities extracted
- Check that an LLM provider is configured (OPENAI_API_KEY or ANTHROPIC_API_KEY)
- Try lowering `minConfidence` in config
- Ensure text contains meaningful entities (not just greetings)

### Duplicate entities
- Run `memory-graph deduplicate` to merge similar entities
- Adjust `deduplication.similarityThreshold` in config

### Query returns no results
- Check `memory-graph stats` to verify graph has data
- Try broader search terms
- Increase `query.maxHops` for multi-hop questions
