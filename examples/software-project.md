# Software Project Tracking

Track your codebase, team, tech stack, and dependencies.

## Recommended Domain Config

```json
{
  "domains": [
    {
      "name": "software",
      "entityHints": ["Person", "Repository", "Service", "Language", "Framework", "Database", "Platform", "Tool"],
      "relationHints": ["MAINTAINS", "CONTRIBUTES_TO", "USES", "DEPENDS_ON", "DEPLOYS_TO", "WRITTEN_IN", "OWNS", "REVIEWS"]
    }
  ]
}
```

## Example Session

```bash
# Team and projects
memory-graph ingest "Our team: Alice (backend lead), Bob (frontend), Charlie (DevOps). Main repo is api-gateway written in Go."
memory-graph ingest "Bob maintains the dashboard repo, built with React and TypeScript."
memory-graph ingest "Charlie manages our Kubernetes cluster on AWS EKS."

# Dependencies and architecture
memory-graph ingest "api-gateway depends on PostgreSQL and Redis. It communicates with the auth-service via gRPC."
memory-graph ingest "The dashboard calls api-gateway through a GraphQL layer."

# Queries
memory-graph ask "What does Alice work on?"
# → Alice is the backend lead, works on api-gateway

memory-graph ask "What technologies does the dashboard use?"
# → React, TypeScript, GraphQL

memory-graph ask "How is the dashboard connected to PostgreSQL?"
# → dashboard -[CALLS]-> api-gateway -[DEPENDS_ON]-> PostgreSQL

memory-graph path "Bob" "PostgreSQL"
# → Bob -[MAINTAINS]-> dashboard -[CALLS]-> api-gateway -[DEPENDS_ON]-> PostgreSQL

memory-graph search --type Service
# → api-gateway, auth-service

memory-graph search --type Database
# → PostgreSQL, Redis
```

## Useful Queries for Dev Teams

- "What services depend on Redis?"
- "Who maintains the auth service?"
- "What's the path from frontend to database?"
- "List all Go services"
- "What does Charlie own?"
