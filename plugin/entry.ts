import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolve } from "node:path";
import { homedir } from "node:os";

// LLM provider env: user can set OPENAI_API_KEY + OPENAI_BASE_URL for any OpenAI-compatible provider.
// Defaults to local 9router if nothing is set (works out of the box for OpenClaw users with 9router).
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.MEMORY_GRAPH_API_KEY || "sk-local";
}
if (!process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL = process.env.MEMORY_GRAPH_BASE_URL || "http://127.0.0.1:20128/v1";
}

// Inline Type helpers (avoid @sinclair/typebox dependency resolution issues)
const Type = {
  Object: (props: Record<string, any>) => ({ type: "object", properties: props, required: Object.keys(props).filter(k => !props[k]._optional) }),
  String: (opts?: any) => ({ type: "string", ...opts }),
  Number: (opts?: any) => ({ type: "number", ...opts }),
  Optional: (schema: any) => ({ ...schema, _optional: true }),
};

// Lazy-loaded graph engine to avoid blocking startup
let graphInstance: any = null;

function getDbPath(config: any): string {
  const raw = config?.dbPath || "~/.openclaw/data/memory-graph.db";
  return raw.startsWith("~") ? resolve(homedir(), raw.slice(2)) : resolve(raw);
}

async function getGraph(config: any) {
  if (!graphInstance) {
    const { MemoryGraph } = await import("../src/index.js");
    graphInstance = new MemoryGraph({
      path: getDbPath(config),
      config: {
        extraction: {
          provider: "openai" as const,
          model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
          autoExtract: true,
          minConfidence: config?.minConfidence ?? 0.7,
          batchSize: 5,
        },
        domains: config?.domains ?? [],
        query: {
          maxHops: config?.maxHops ?? 3,
          maxResults: 10,
          includeConfidence: true,
        },
      },
    });

    // Set env for OpenAI client to use local 9router
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "sk-local";
    }
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = "http://127.0.0.1:20128/v1";
    }
  }
  return graphInstance;
}

// ─── Message Buffer for Batch Extraction ────────────────────
// Gom messages gần nhau thành batch trước khi gọi LLM
const messageBuffer: { text: string; senderId: string; sessionKey: string; timestamp: number }[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_WINDOW_MS = 15000; // 15 seconds window
const BATCH_MAX_MESSAGES = 5;

async function flushBatch(config: any) {
  if (messageBuffer.length === 0) return;
  
  const batch = messageBuffer.splice(0, messageBuffer.length);
  const combinedText = batch.map(m => m.text).join('\n');
  const source = `chat:${batch[0].senderId}`;
  const sessionKey = batch[0].sessionKey;
  
  try {
    const graph = await getGraph(config);
    await graph.ingest(combinedText, { source, sessionId: sessionKey });
  } catch (err) {
    console.warn("[memory-graph] Batch ingest failed:", (err as Error).message);
  }
}

// ─── Smart Message Filter ────────────────────────────────────
// Determines if a message is worth extracting entities from.
// Skips: commands, tokens/secrets, casual chat, URLs-only, too short.

const COMMAND_PATTERNS = /^\s*[\/!](new|reset|status|help|start|stop|restart|approve|elevated|exec|reasoning|model|clear)\b/i;
const TOKEN_PATTERNS = /(?:npm_|clh_|ghp_|gho_|sk-|xox[bpas]-|Bearer\s+|token[:\s]+\S{20,}|[A-Za-z0-9_-]{40,})/;
const CASUAL_PATTERNS = /^\s*(ok|oke|okie|oki|yes|no|yep|nope|sure|đi|đc|dc|ừ|ờ|uh|hmm|hm|ah|oh|wow|nice|cool|good|great|thanks|thx|cảm ơn|sao rồi|sao r|ổn không|ổn k|gà ơi|gà|em ơi|sếp ơi|aira ơi|tiếp|tiếp đi|continue|go|done|xong|rồi|chưa|có|không|ko|k|đúng|sai|được|đc rồi|ok em|ok anh)\s*[?!.]*\s*$/i;
const URL_ONLY_PATTERN = /^\s*(https?:\/\/\S+\s*)+$/;
const MIN_MEANINGFUL_LENGTH = 30; // Minimum chars for meaningful content
const MIN_WORD_COUNT = 5; // Minimum words

function shouldIngest(text: string): boolean {
  // Too short
  if (text.length < MIN_MEANINGFUL_LENGTH) return false;
  
  // Commands
  if (COMMAND_PATTERNS.test(text)) return false;
  
  // Contains tokens/secrets
  if (TOKEN_PATTERNS.test(text)) return false;
  
  // Pure casual chat
  if (CASUAL_PATTERNS.test(text)) return false;
  
  // URL-only messages (no context)
  if (URL_ONLY_PATTERN.test(text)) return false;
  
  // Too few words (even if long due to a single token/hash)
  const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;
  if (wordCount < MIN_WORD_COUNT) return false;
  
  return true;
}

export default definePluginEntry({
  id: "memory-graph",
  name: "Memory Graph",
  description:
    "Auto-builds a knowledge graph from conversations. Extracts entities/relationships and exposes graph query tools.",

  register(api) {
    // ─── Hook: Auto-ingest on every inbound message ─────────────
    api.on(
      "message_received",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.autoIngest === false) return;

        // event.content IS the message text (string), not an object
        const text = typeof event.content === 'string' ? event.content : (event.content?.text || event.content?.body || "");
        
        if (!text || !shouldIngest(text)) return;

        // Batch mode: buffer messages and flush after window or max count
        messageBuffer.push({
          text,
          senderId: event.senderId || "unknown",
          sessionKey: event.sessionKey || "",
          timestamp: Date.now(),
        });

        // Flush immediately if buffer is full
        if (messageBuffer.length >= BATCH_MAX_MESSAGES) {
          if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
          await flushBatch(config);
          return;
        }

        // Otherwise, set/reset timer to flush after window
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(() => {
          batchTimer = null;
          flushBatch(config).catch(err => {
            console.warn("[memory-graph] Batch flush failed:", (err as Error).message);
          });
        }, BATCH_WINDOW_MS);
      },
      { priority: 10 },
    );

    // ─── Hook: Cleanup on gateway stop ──────────────────────────
    api.on("gateway_stop", async () => {
      if (graphInstance) {
        graphInstance.close();
        graphInstance = null;
      }
    });

    // ─── Tool: Query (natural language) ─────────────────────────
    api.registerTool({
      name: "memory_graph_query",
      description:
        "Ask a natural language question against the knowledge graph. Use for relationship questions like 'What does Alice work on?', 'How is X connected to Y?', 'List all projects'.",
      parameters: Type.Object({
        question: Type.String({ description: "Natural language question" }),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const result = await graph.ask(params.question);
        return {
          content: [
            {
              type: "text",
              text: `${result.answer}${result.confidence < 0.5 ? `\n(Low confidence: ${(result.confidence * 100).toFixed(0)}%)` : ""}`,
            },
          ],
        };
      },
    });

    // ─── Tool: Ingest (manual) ──────────────────────────────────
    api.registerTool({
      name: "memory_graph_ingest",
      description:
        "Manually extract entities and relationships from text and store in the knowledge graph. Use when you want to explicitly add information.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to extract entities from" }),
        source: Type.Optional(Type.String({ description: "Source label" })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const result = await graph.ingest(params.text, { source: params.source || "manual" });

        const entities = result.entities
          .map((e: any) => `${e.name} (${e.type})`)
          .join(", ");
        const rels = result.relationships
          .map((r: any) => `${r.from} -[${r.relation}]-> ${r.to}`)
          .join(", ");

        return {
          content: [
            {
              type: "text",
              text: `Extracted ${result.entities.length} entities: ${entities}\nRelationships (${result.relationships.length}): ${rels}`,
            },
          ],
        };
      },
    });

    // ─── Tool: Search ───────────────────────────────────────────
    api.registerTool({
      name: "memory_graph_search",
      description:
        "Search entities in the knowledge graph by keyword or type. Returns matching entities with their relationships.",
      parameters: Type.Object({
        query: Type.String({ description: "Search keyword" }),
        type: Type.Optional(Type.String({ description: "Filter by entity type" })),
        limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);

        if (params.type) {
          const entities = graph.listEntities({ type: params.type, limit: params.limit || 10 });
          const lines = entities.map((e: any) => `${e.name} (${e.type})`);
          return {
            content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No entities found." }],
          };
        }

        const results = graph.search(params.query, params.limit || 10);
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No results found." }] };
        }

        const lines = results.map((r: any) => {
          const rels = r.relations
            .map((rel: any) => `${rel.direction === "outgoing" ? "→" : "←"} ${rel.relation} ${rel.target}`)
            .join("; ");
          return `${r.entity.name} (${r.entity.type})${rels ? ": " + rels : ""}`;
        });

        return { content: [{ type: "text", text: lines.join("\n") }] };
      },
    });

    // ─── Tool: Path finding ─────────────────────────────────────
    api.registerTool({
      name: "memory_graph_path",
      description:
        "Find the shortest path between two entities in the knowledge graph. Shows how they are connected through relationships.",
      parameters: Type.Object({
        from: Type.String({ description: "Starting entity name" }),
        to: Type.String({ description: "Target entity name" }),
        maxHops: Type.Optional(Type.Number({ description: "Maximum traversal hops", default: 3 })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const path = graph.findPath(params.from, params.to, params.maxHops || 3);

        if (!path) {
          return {
            content: [{ type: "text", text: `No path found between "${params.from}" and "${params.to}".` }],
          };
        }

        const display = path.path
          .map((node: string, i: number) => (i < path.relations.length ? `${node} ${path.relations[i]}` : node))
          .join(" ");

        return { content: [{ type: "text", text: `Path: ${display}` }] };
      },
    });

    // ─── Tool: Stats ────────────────────────────────────────────
    api.registerTool({
      name: "memory_graph_stats",
      description: "Show knowledge graph statistics: entity count, relationship count, types.",
      parameters: Type.Object({}),
      async execute(_id, _params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const stats = graph.stats();

        return {
          content: [
            {
              type: "text",
              text: [
                `Entities: ${stats.entities}`,
                `Relationships: ${stats.relationships}`,
                `Entity types: ${stats.entityTypes.join(", ") || "(none)"}`,
                `Relation types: ${stats.relationTypes.join(", ") || "(none)"}`,
                `Oldest: ${stats.oldestEntry || "(empty)"}`,
                `Newest: ${stats.newestEntry || "(empty)"}`,
              ].join("\n"),
            },
          ],
        };
      },
    });
  },
});
