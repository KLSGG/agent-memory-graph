# Personal CRM

Track people, companies, interactions, and context from your professional network.

## Recommended Domain Config

```json
{
  "domains": [
    {
      "name": "crm",
      "entityHints": ["Person", "Company", "Role", "Event", "Topic", "Location", "Deal"],
      "relationHints": ["WORKS_AT", "KNOWS", "MET_AT", "INTERESTED_IN", "INTRODUCED_BY", "DISCUSSED", "LOCATED_IN"]
    }
  ]
}
```

## Example Session

```bash
# Meeting notes
memory-graph ingest "Met David Chen at ETHDenver 2026. He's CTO at Nexus Labs, working on ZK rollups. Interested in our API."
memory-graph ingest "Sarah Kim from Acme Corp introduced me to David. She's their Head of Partnerships."
memory-graph ingest "Follow-up call with David scheduled for next Tuesday. He wants to integrate our auth SDK."

# Queries
memory-graph ask "How do I know David Chen?"
# → Met at ETHDenver 2026, introduced by Sarah Kim from Acme Corp

memory-graph ask "Who works at Nexus Labs?"
# → David Chen (CTO)

memory-graph ask "What is David interested in?"
# → ZK rollups, your API, auth SDK integration

memory-graph path "Sarah Kim" "ZK rollups"
# → Sarah Kim -[INTRODUCED]-> David Chen -[WORKS_ON]-> ZK rollups

memory-graph search --type Company
# → Nexus Labs, Acme Corp
```

## Useful Queries for Networking

- "Who did I meet at [event]?"
- "Who works on [topic]?"
- "How am I connected to [person]?"
- "What companies are interested in our product?"
- "Who introduced me to [person]?"
