# Research Notes

Connect papers, topics, authors, findings, and methodologies.

## Recommended Domain Config

```json
{
  "domains": [
    {
      "name": "research",
      "entityHints": ["Paper", "Author", "Topic", "Method", "Dataset", "Finding", "Institution", "Conference"],
      "relationHints": ["AUTHORED_BY", "CITES", "USES_METHOD", "EVALUATED_ON", "PUBLISHED_AT", "AFFILIATED_WITH", "EXTENDS", "CONTRADICTS"]
    }
  ]
}
```

## Example Session

```bash
# Reading papers
memory-graph ingest "Read 'Attention Is All You Need' by Vaswani et al. (2017). Introduces the Transformer architecture. Published at NeurIPS."
memory-graph ingest "BERT by Devlin et al. (2019) extends Transformers with bidirectional pre-training. Evaluated on GLUE and SQuAD benchmarks."
memory-graph ingest "GPT-4 technical report (OpenAI, 2023) shows scaling laws still hold. Uses RLHF for alignment."

# Connecting ideas
memory-graph ingest "Graphiti paper (Zep, 2025) proposes temporal knowledge graphs for agent memory. Builds on ideas from MemGPT."
memory-graph ingest "Mem0 (2025) achieves 92.5 on LoCoMo benchmark using multi-signal retrieval. Outperforms MemGPT and Zep."

# Queries
memory-graph ask "What papers use Transformers?"
# → BERT, GPT-4 (both extend the Transformer architecture from 'Attention Is All You Need')

memory-graph ask "What benchmarks are used for memory systems?"
# → LoCoMo, GLUE, SQuAD, LongMemEval

memory-graph path "BERT" "LoCoMo"
# → BERT -[EXTENDS]-> Transformer -[USED_BY]-> MemGPT -[EVALUATED_ON]-> LoCoMo

memory-graph search --type Method
# → Transformer, RLHF, multi-signal retrieval, temporal knowledge graph
```

## Useful Queries for Researchers

- "What methods does [paper] use?"
- "What papers cite [paper]?"
- "Who works on [topic]?"
- "What datasets are used for [task]?"
- "How is [concept A] related to [concept B]?"
