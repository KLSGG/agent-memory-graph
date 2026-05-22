import { naturalLanguageQuery } from '../src/search/natural-language.js';
import { GraphEngine } from '../src/graph/engine.js';
import { ConfigSchema } from '../src/config/schema.js';

const engine = new GraphEngine('/home/aira/.openclaw/data/memory-graph.db');
const config = ConfigSchema.parse({});

const tests = [
  'What projects is David working on?',
  "Who are David's clients?",
  'What tools does Bob use?',
  'What does Sếp KL build?',
  'List all projects',
  'How is David connected to DeFi Labs?',
];

for (const q of tests) {
  const r = await naturalLanguageQuery(q, engine, config);
  console.log(`Q: ${q}`);
  console.log(`A: ${r.answer} (${(r.confidence * 100).toFixed(0)}%)`);
  console.log('---');
}

engine.close();
