import { naturalLanguageQuery } from '../src/search/natural-language.js';
import { GraphEngine } from '../src/graph/engine.js';
import { ConfigSchema } from '../src/config/schema.js';

const engine = new GraphEngine('/home/aira/.openclaw/data/memory-graph.db');
const config = ConfigSchema.parse({});

const tests = [
  'Where did Tomoko work before?',
  "What is Marcus's role?",
  'Who works at Acme Corp?',
  'What programming languages are mentioned?',
  'List all people',
  'Who suggested pglogical?',
  'What does Acme Corp use?',
  'What projects is David working on?',
  'How is Marcus connected to Terraform?',
  'What is Project Phoenix?',
];

for (const q of tests) {
  const r = await naturalLanguageQuery(q, engine, config);
  console.log(`Q: ${q}`);
  console.log(`A: ${r.answer.split('\n')[0]} | ${(r.confidence*100).toFixed(0)}%`);
  console.log('---');
}
engine.close();
