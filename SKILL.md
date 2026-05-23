# agent-memory-graph

Auto-builds a temporal knowledge graph from conversations. Extracts entities and relationships, tracks fact validity over time, and exposes graph query tools to the agent.

## Features

- **Auto-ingest**: Extracts entities/relationships from every meaningful message
- **Session summary**: Summarizes key actions at end of each session and ingests into graph
- **Prompt injection**: Automatically injects relevant graph context into agent prompts
- **Temporal validity** (Graphiti-inspired): Facts have valid_from/valid_until timestamps. Old facts are superseded, never deleted.
- **Confidence decay** (agentmemory-inspired): Older, unaccessed knowledge gradually loses confidence. Keeps the graph fresh.
- **Lifecycle states**: Entities/relationships are `active`, `stale`, or `superseded`

## Tools

| Tool | Description |
|------|-------------|
| `memory_graph_query` | Natural language question against the graph |
| `memory_graph_ingest` | Manually extract and store entities from text |
| `memory_graph_search` | Search entities by keyword or type |
| `memory_graph_path` | Find shortest path between two entities |
| `memory_graph_stats` | Graph statistics with temporal breakdown |
| `memory_graph_temporal` | Query facts valid at a specific point in time |
| `memory_graph_supersede` | Update a fact by superseding the old one |
| `memory_graph_decay` | Apply confidence decay to stale knowledge |

## Configuration

```json
{
  "plugins": {
    "entries": {
      "memory-graph": {
        "enabled": true,
        "config": {
          "dbPath": "~/.openclaw/data/memory-graph.db",
          "autoIngest": true,
          "sessionSummary": true,
          "promptInjection": true,
          "extractionModel": "kr/claude-haiku-4.5",
          "minConfidence": 0.7,
          "maxHops": 3
        },
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

## Architecture

- **Storage**: SQLite (local-first, zero external dependencies)
- **Extraction**: LLM-powered entity/relationship extraction via OpenAI-compatible API
- **Search**: Hybrid (FTS5 full-text + LIKE fallback + graph traversal)
- **Temporal**: Validity windows on relationships, confidence decay on entities
- **Hooks**: `message_received` (auto-ingest), `agent_end` (session summary), `before_prompt_build` (context injection)

## Inspired By

- **Graphiti/Zep**: Temporal context graphs, fact validity windows, provenance tracking
- **agentmemory**: Confidence scoring, lifecycle management, hybrid search
