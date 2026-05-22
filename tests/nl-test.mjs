import { MemoryGraph } from '../src/index.js';

const graph = new MemoryGraph({ path: '/home/aira/.openclaw/data/memory-graph.db' });

const tests = [
  'What projects is David working on?',
  "Who are David's clients?",
  'What tools does Bob use?',
  'What does Sếp KL build?',
  'List all projects',
  'How is David connected to DeFi Labs?',
];

for (const q of tests) {
  const r = await graph.ask(q);
  console.log(`Q: ${q}`);
  console.log(`A: ${r.answer} (${(r.confidence * 100).toFixed(0)}%)`);
  console.log('---');
}

graph.close();
