#!/usr/bin/env node
import { resolve } from 'node:path';
import { MemoryGraph } from '../src/index.js';
const HELP = `
agent-memory-graph — Knowledge graph memory for AI agents

Usage:
  memory-graph <command> [options]

Commands:
  init                          Initialize config and database
  ingest <text>                 Extract entities/relationships from text
  ingest --file <path>          Extract from a file
  ask <question>                Ask a natural language question
  search <query>                Search entities
  add entity <name> <type>      Add an entity manually
  add relation <from> <rel> <to>  Add a relationship manually
  find <name>                   Find an entity by name
  path <from> <to>              Find shortest path between entities
  neighborhood <name> [hops]    Get neighborhood of an entity
  visualize [--format fmt]      Export graph (mermaid|json|dot|csv)
  sync --source <path>          Import from MEMORY.md or directory
  deduplicate [--auto]          Find and merge duplicate entities
  stats                         Show graph statistics
  help                          Show this help

Options:
  --db <path>                   Database file path (default: ./memory-graph.db)
  --config <path>               Config file path
  --format <fmt>                Export format: mermaid, json, dot, csv
  --type <type>                 Filter by entity type
  --limit <n>                   Limit results
  --hops <n>                    Max traversal hops (default: 3)

Examples:
  memory-graph ingest "Alice works on Project Atlas with Bob"
  memory-graph ask "What projects is Alice working on?"
  memory-graph search "Alice"
  memory-graph add entity "Docker" Tool
  memory-graph add relation "Project Atlas" USES "Docker"
  memory-graph path "Alice" "Docker"
  memory-graph visualize --format mermaid
  memory-graph sync --source ./MEMORY.md
  memory-graph stats
`;
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
        console.log(HELP.trim());
        process.exit(0);
    }
    // Parse global options
    const dbPath = getOption(args, '--db') ?? './memory-graph.db';
    const configPath = getOption(args, '--config');
    const graph = new MemoryGraph({ path: resolve(dbPath), configPath: configPath ? resolve(configPath) : undefined });
    try {
        const command = args[0];
        switch (command) {
            case 'init': {
                const { writeFileSync, existsSync, mkdirSync } = await import('node:fs');
                if (!existsSync('config'))
                    mkdirSync('config');
                if (!existsSync('config/graph.config.json')) {
                    writeFileSync('config/graph.config.json', JSON.stringify({
                        storage: { path: './memory-graph.db' },
                        extraction: { provider: 'auto', model: 'auto', autoExtract: true, minConfidence: 0.7 },
                        domains: [],
                        query: { maxHops: 3, maxResults: 10 },
                    }, null, 2));
                    console.log('✓ Created config/graph.config.json');
                }
                else {
                    console.log('• config/graph.config.json already exists');
                }
                console.log(`✓ Database ready at ${dbPath}`);
                const stats = graph.stats();
                console.log(`  Entities: ${stats.entities}, Relationships: ${stats.relationships}`);
                break;
            }
            case 'ingest': {
                const filePath = getOption(args, '--file');
                let text;
                if (filePath) {
                    const { readFileSync } = await import('node:fs');
                    text = readFileSync(resolve(filePath), 'utf-8');
                }
                else {
                    text = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
                }
                if (!text.trim()) {
                    console.error('Error: No text provided. Use: memory-graph ingest "your text" or --file <path>');
                    process.exit(1);
                }
                console.log('Extracting entities and relationships...');
                const result = await graph.ingest(text, { source: filePath ?? 'cli' });
                console.log(`✓ Extracted ${result.entities.length} entities, ${result.relationships.length} relationships`);
                if (result.entities.length > 0) {
                    console.log('\nEntities:');
                    for (const e of result.entities) {
                        console.log(`  • ${e.name} (${e.type}) [${(e.confidence * 100).toFixed(0)}%]`);
                    }
                }
                if (result.relationships.length > 0) {
                    console.log('\nRelationships:');
                    for (const r of result.relationships) {
                        console.log(`  • ${r.from} -[${r.relation}]-> ${r.to} [${(r.confidence * 100).toFixed(0)}%]`);
                    }
                }
                break;
            }
            case 'ask': {
                const question = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
                if (!question.trim()) {
                    console.error('Error: No question provided.');
                    process.exit(1);
                }
                const result = await graph.ask(question);
                console.log(result.answer);
                if (result.confidence < 0.5) {
                    console.log(`\n(Low confidence: ${(result.confidence * 100).toFixed(0)}%)`);
                }
                break;
            }
            case 'search': {
                const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
                const limit = parseInt(getOption(args, '--limit') ?? '10', 10);
                if (!query.trim()) {
                    console.error('Error: No search query provided.');
                    process.exit(1);
                }
                const results = graph.search(query, limit);
                if (results.length === 0) {
                    console.log('No results found.');
                }
                else {
                    for (const r of results) {
                        console.log(`\n${r.entity.name} (${r.entity.type})`);
                        for (const rel of r.relations) {
                            const arrow = rel.direction === 'outgoing' ? '→' : '←';
                            console.log(`  ${arrow} ${rel.relation} ${rel.target} (${rel.targetType})`);
                        }
                    }
                }
                break;
            }
            case 'add': {
                const subCommand = args[1];
                if (subCommand === 'entity') {
                    const name = args[2];
                    const type = args[3] ?? 'Unknown';
                    if (!name) {
                        console.error('Error: Usage: memory-graph add entity <name> <type>');
                        process.exit(1);
                    }
                    const entity = graph.addEntity(name, type);
                    console.log(`✓ Added entity: ${entity.name} (${entity.type}) [${entity.id}]`);
                }
                else if (subCommand === 'relation') {
                    const from = args[2];
                    const relation = args[3];
                    const to = args[4];
                    if (!from || !relation || !to) {
                        console.error('Error: Usage: memory-graph add relation <from> <relation> <to>');
                        process.exit(1);
                    }
                    const rel = graph.addRelation(from, relation, to);
                    console.log(`✓ Added: ${from} -[${relation}]-> ${to} [${rel.id}]`);
                }
                else {
                    console.error('Error: Usage: memory-graph add entity|relation ...');
                    process.exit(1);
                }
                break;
            }
            case 'find': {
                const name = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
                const type = getOption(args, '--type');
                if (!name.trim()) {
                    console.error('Error: No entity name provided.');
                    process.exit(1);
                }
                const entity = graph.findEntity(name, type ?? undefined);
                if (!entity) {
                    console.log(`Entity "${name}" not found.`);
                }
                else {
                    console.log(`${entity.name} (${entity.type})`);
                    console.log(`  ID: ${entity.id}`);
                    console.log(`  Confidence: ${(entity.confidence * 100).toFixed(0)}%`);
                    console.log(`  Created: ${entity.created_at}`);
                    if (Object.keys(entity.properties).length > 0) {
                        console.log(`  Properties: ${JSON.stringify(entity.properties)}`);
                    }
                }
                break;
            }
            case 'path': {
                const from = args[1];
                const to = args[2];
                const maxHops = parseInt(getOption(args, '--hops') ?? '3', 10);
                if (!from || !to) {
                    console.error('Error: Usage: memory-graph path <from> <to>');
                    process.exit(1);
                }
                const path = graph.findPath(from, to, maxHops);
                if (!path) {
                    console.log(`No path found between "${from}" and "${to}" within ${maxHops} hops.`);
                }
                else {
                    const display = path.path
                        .map((node, i) => i < path.relations.length ? `${node} ${path.relations[i]}` : node)
                        .join(' ');
                    console.log(`Path: ${display}`);
                }
                break;
            }
            case 'neighborhood': {
                const name = args[1];
                const hops = parseInt(args[2] ?? getOption(args, '--hops') ?? '1', 10);
                if (!name) {
                    console.error('Error: Usage: memory-graph neighborhood <name> [hops]');
                    process.exit(1);
                }
                const result = graph.neighborhood(name, hops);
                console.log(`Neighborhood of "${name}" (${hops} hop${hops > 1 ? 's' : ''}):`);
                console.log(`  Entities: ${result.entities.length}`);
                for (const e of result.entities) {
                    console.log(`    • ${e.name} (${e.type})`);
                }
                console.log(`  Relationships: ${result.relationships.length}`);
                break;
            }
            case 'visualize':
            case 'export': {
                const format = (getOption(args, '--format') ?? 'mermaid');
                const output = graph.export(format);
                console.log(output);
                break;
            }
            case 'sync': {
                const source = getOption(args, '--source');
                if (!source) {
                    console.error('Error: Usage: memory-graph sync --source <path>');
                    process.exit(1);
                }
                console.log(`Importing from ${source}...`);
                const result = await graph.importFrom(resolve(source));
                console.log(`✓ Imported ${result.entities} entities, ${result.relationships} relationships`);
                break;
            }
            case 'deduplicate': {
                const autoMerge = args.includes('--auto');
                const duplicates = graph.deduplicate({ autoMerge });
                if (duplicates.length === 0) {
                    console.log('No duplicates found.');
                }
                else {
                    console.log(`Found ${duplicates.length} potential duplicate(s):`);
                    for (const d of duplicates) {
                        console.log(`  • "${d.entity}" ≈ "${d.duplicateOf}" (${(d.similarity * 100).toFixed(0)}% similar)`);
                    }
                    if (autoMerge) {
                        console.log(`\n✓ Auto-merged ${duplicates.length} duplicates.`);
                    }
                    else {
                        console.log('\nRun with --auto to merge automatically.');
                    }
                }
                break;
            }
            case 'stats': {
                const stats = graph.stats();
                console.log('Graph Statistics:');
                console.log(`  Entities: ${stats.entities}`);
                console.log(`  Relationships: ${stats.relationships}`);
                console.log(`  Entity types: ${stats.entityTypes.join(', ') || '(none)'}`);
                console.log(`  Relation types: ${stats.relationTypes.join(', ') || '(none)'}`);
                console.log(`  Oldest entry: ${stats.oldestEntry ?? '(empty)'}`);
                console.log(`  Newest entry: ${stats.newestEntry ?? '(empty)'}`);
                break;
            }
            default:
                console.error(`Unknown command: ${command}`);
                console.log('Run "memory-graph help" for usage.');
                process.exit(1);
        }
    }
    finally {
        graph.close();
    }
}
// ─── Helpers ─────────────────────────────────────────────────────
function getOption(args, flag) {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length)
        return null;
    return args[idx + 1];
}
main().catch(err => {
    console.error('Error:', err.message ?? err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map