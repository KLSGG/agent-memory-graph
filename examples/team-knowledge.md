# Team Knowledge Map

Map team expertise, ownership, and knowledge areas across your organization.

## Recommended Domain Config

```json
{
  "domains": [
    {
      "name": "team",
      "entityHints": ["Person", "Team", "Skill", "Domain", "Service", "Document", "Process"],
      "relationHints": ["EXPERT_IN", "OWNS", "MEMBER_OF", "DOCUMENTS", "RESPONSIBLE_FOR", "MENTORS", "BACKUP_FOR"]
    }
  ]
}
```

## Example Session

```bash
# Team structure
memory-graph ingest "Engineering team: Alice (backend), Bob (frontend), Charlie (infra), Diana (data). Alice leads the team."
memory-graph ingest "Alice is expert in Go and distributed systems. She owns the payment service."
memory-graph ingest "Bob knows React, TypeScript, and accessibility. He's backup for the design system."
memory-graph ingest "Charlie manages Kubernetes, Terraform, and CI/CD pipelines. He mentors Diana on infra."
memory-graph ingest "Diana handles data pipelines with Python and Spark. She owns the analytics dashboard."

# Knowledge queries
memory-graph ask "Who knows about Kubernetes?"
# → Charlie (manages it), Diana (mentored by Charlie)

memory-graph ask "Who owns the payment service?"
# → Alice

memory-graph ask "What skills does the team have?"
# → Go, distributed systems, React, TypeScript, accessibility, Kubernetes, Terraform, Python, Spark

memory-graph ask "Who can help with infrastructure if Charlie is out?"
# → Diana (mentored by Charlie on infra)

memory-graph path "Bob" "Kubernetes"
# → Bob -[MEMBER_OF]-> Engineering -[MEMBER_OF]<- Charlie -[EXPERT_IN]-> Kubernetes
```

## Useful Queries for Team Leads

- "Who is expert in [technology]?"
- "Who owns [service]?"
- "What does [person] know?"
- "Who is backup for [area]?"
- "What skills are we missing?"
