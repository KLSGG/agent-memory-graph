/**
 * MCP (Model Context Protocol) server for agent-memory-graph.
 * Exposes graph tools via stdio MCP protocol so external clients
 * (Claude Code, Cursor, Gemini CLI, etc.) can use the knowledge graph.
 *
 * Usage: node dist/mcp/server.js [--db-path <path>]
 */

import { GraphEngine } from '../graph/engine.js';
import { semanticSearch, embedMissingEntities } from '../search/semantic.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const DEFAULT_DB_PATH = resolve(homedir(), '.openclaw/data/memory-graph.db');

export class MCPServer {
  private engine: GraphEngine;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || DEFAULT_DB_PATH;
    this.engine = new GraphEngine(this.dbPath);
  }

  /** List available tools (MCP tools/list) */
  listTools() {
    return {
      tools: [
        {
          name: 'memory_graph_search',
          description: 'Search entities in the knowledge graph by keyword or type.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search keyword' },
              type: { type: 'string', description: 'Filter by entity type' },
              limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['query'],
          },
        },
        {
          name: 'memory_graph_query',
          description: 'Ask a natural language question against the knowledge graph.',
          inputSchema: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Natural language question' },
            },
            required: ['question'],
          },
        },
        {
          name: 'memory_graph_ingest',
          description: 'Extract entities and relationships from text and store in the graph.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to extract entities from' },
              source: { type: 'string', description: 'Source label' },
            },
            required: ['text'],
          },
        },
        {
          name: 'memory_graph_path',
          description: 'Find shortest path between two entities.',
          inputSchema: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Starting entity name' },
              to: { type: 'string', description: 'Target entity name' },
              maxHops: { type: 'number', description: 'Maximum hops (default 3)' },
            },
            required: ['from', 'to'],
          },
        },
        {
          name: 'memory_graph_stats',
          description: 'Show knowledge graph statistics.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'memory_graph_temporal',
          description: 'Query facts valid at a specific point in time.',
          inputSchema: {
            type: 'object',
            properties: {
              entity: { type: 'string', description: 'Entity name' },
              at: { type: 'string', description: 'ISO timestamp (default: now)' },
              includeSuperseded: { type: 'boolean', description: 'Include invalidated facts' },
            },
            required: ['entity'],
          },
        },
        {
          name: 'memory_graph_supersede',
          description: 'Update a fact by superseding the old one.',
          inputSchema: {
            type: 'object',
            properties: {
              entity: { type: 'string', description: 'Subject entity' },
              relation: { type: 'string', description: 'Relationship type' },
              oldTarget: { type: 'string', description: 'Old target (being superseded)' },
              newTarget: { type: 'string', description: 'New target (current truth)' },
              source: { type: 'string', description: 'Source label' },
            },
            required: ['entity', 'relation', 'oldTarget', 'newTarget'],
          },
        },
        {
          name: 'memory_graph_semantic_search',
          description: 'Semantic/vector search for similar entities.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['query'],
          },
        },
      ],
    };
  }

  /** Execute a tool call */
  async callTool(name: string, args: any): Promise<{ content: { type: string; text: string }[] }> {
    switch (name) {
      case 'memory_graph_search': {
        const results = this.engine.searchEntities(args.query, args.limit || 10);
        const filtered = args.type
          ? results.filter(e => e.type.toLowerCase() === args.type.toLowerCase())
          : results;
        const text = filtered.length > 0
          ? filtered.map(e => `${e.name} (${e.type}) [confidence: ${(e.confidence * 100).toFixed(0)}%]`).join('\n')
          : `No entities found for "${args.query}"`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memory_graph_stats': {
        const stats = this.engine.stats();
        return {
          content: [{
            type: 'text',
            text: [
              `Entities: ${stats.entities} (stale: ${stats.staleEntities || 0})`,
              `Relationships: ${stats.relationships} (active: ${stats.activeRelationships}, superseded: ${stats.supersededRelationships})`,
              `Entity types: ${stats.entityTypes.join(', ')}`,
              `Oldest: ${stats.oldestEntry || '(empty)'}`,
              `Newest: ${stats.newestEntry || '(empty)'}`,
            ].join('\n'),
          }],
        };
      }

      case 'memory_graph_path': {
        const result = this.engine.findPath(args.from, args.to, args.maxHops || 3);
        const text = result
          ? `Path: ${result.path.join(' → ')}\nRelations: ${result.relations.join(' ')}`
          : `No path found between "${args.from}" and "${args.to}"`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memory_graph_temporal': {
        const atTime = args.at || new Date().toISOString();
        const entity = this.engine.findEntityByName(args.entity);
        if (!entity) return { content: [{ type: 'text', text: `Entity "${args.entity}" not found.` }] };
        
        this.engine.touchEntity(entity.id);
        const rels = this.engine.getRelationsAtTime(args.entity, atTime);
        const lines = rels.map(r => `→ ${r.relation} ${r.to_name} (confidence: ${(r.confidence * 100).toFixed(0)}%)`);
        
        let text = `${entity.name} (${entity.type}) at ${atTime}:\n${lines.join('\n') || '(no facts)'}`;
        
        if (args.includeSuperseded) {
          const all = this.engine.getRelationsFrom(entity.id, true);
          const superseded = all.filter(r => r.lifecycle === 'superseded' || r.valid_until);
          if (superseded.length > 0) {
            text += '\n\nSuperseded:\n' + superseded.map(r => `✗ ${r.relation} ${(r as any).to_name || r.to_id}`).join('\n');
          }
        }
        return { content: [{ type: 'text', text }] };
      }

      case 'memory_graph_supersede': {
        const result = this.engine.supersedeRelation(
          args.entity, args.relation, args.oldTarget, args.newTarget,
          { source: args.source || 'mcp' }
        );
        const text = result.invalidated
          ? `Invalidated: ${args.entity} -[${args.relation}]-> ${args.oldTarget}\nCreated: ${args.entity} -[${args.relation}]-> ${args.newTarget}`
          : `No existing relation found. Created: ${args.entity} -[${args.relation}]-> ${args.newTarget}`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memory_graph_semantic_search': {
        const db = (this.engine as any).db;
        const results = await semanticSearch(db, args.query, { limit: args.limit || 10 });
        const text = results.length > 0
          ? results.map(r => `${r.entity_name} (${r.entity_type}) [similarity: ${(r.similarity * 100).toFixed(1)}%]`).join('\n')
          : `No semantic matches for "${args.query}" (embeddings may need to be generated first)`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memory_graph_ingest': {
        // For MCP, we need the full MemoryGraph instance for extraction
        // Simplified: just store the text in memory_log for now
        this.engine.logExtraction(args.text, [], [], args.source);
        return { content: [{ type: 'text', text: `Text logged. Full extraction requires LLM — use the OpenClaw plugin for auto-extraction.` }] };
      }

      case 'memory_graph_query': {
        // Simplified NL query via search
        const results = this.engine.searchEntities(args.question, 5);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No relevant entities found for: "${args.question}"` }] };
        }
        const lines = results.map(e => {
          const rels = this.engine.getActiveRelationsFrom(e.id);
          const relText = rels.slice(0, 3).map(r => `→ ${r.relation} ${r.to_name}`).join(', ');
          return `${e.name} (${e.type}): ${relText || '(no relations)'}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** Handle a single MCP JSON-RPC request */
  async handleRequest(req: MCPRequest): Promise<MCPResponse> {
    try {
      switch (req.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'agent-memory-graph', version: '0.7.0' },
            },
          };

        case 'tools/list':
          return { jsonrpc: '2.0', id: req.id, result: this.listTools() };

        case 'tools/call': {
          const { name, arguments: args } = req.params;
          const result = await this.callTool(name, args || {});
          return { jsonrpc: '2.0', id: req.id, result };
        }

        case 'notifications/initialized':
          // Client ack — no response needed for notifications
          return { jsonrpc: '2.0', id: req.id, result: {} };

        default:
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32000, message: (err as Error).message },
      };
    }
  }

  /** Start stdio MCP server */
  start(): void {
    const rl = createInterface({ input: process.stdin, terminal: false });

    rl.on('line', async (line) => {
      if (!line.trim()) return;
      try {
        const req = JSON.parse(line) as MCPRequest;
        const res = await this.handleRequest(req);
        // Don't respond to notifications (no id)
        if (req.id !== undefined) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (err) {
        const errorRes: MCPResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32700, message: 'Parse error' },
        };
        process.stdout.write(JSON.stringify(errorRes) + '\n');
      }
    });

    rl.on('close', () => {
      this.engine.close();
      process.exit(0);
    });
  }
}

// CLI entry point
if (process.argv[1]?.includes('mcp') || process.argv.includes('--mcp')) {
  const dbPathIdx = process.argv.indexOf('--db-path');
  const dbPath = dbPathIdx >= 0 ? process.argv[dbPathIdx + 1] : undefined;
  const server = new MCPServer(dbPath);
  server.start();
}
