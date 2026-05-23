import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { MemoryGraph } from "../src/index.js";
import { semanticSearch, embedMissingEntities } from "../src/search/semantic.js";
import { dedupRelations } from "../src/extract/relation-dedup.js";

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

// ─── Session Summary Buffer ─────────────────────────────────
// Track meaningful messages per session for end-of-session summary ingestion
const sessionMessages: Map<string, { text: string; role: string; timestamp: number }[]> = new Map();
const SESSION_SUMMARY_MIN_MESSAGES = 5; // Minimum messages to trigger summary
const SESSION_SUMMARY_MAX_BUFFER = 50; // Max messages to keep per session (rolling window)

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
    // ─── Hook: Inject graph context into every prompt ─────────
    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        const config = (ctx as any)?.pluginConfig;
        if (config?.promptInjection === false) return;

        try {
          const graph = await getGraph(config);
          
          // Get stats first — skip if graph is empty
          const stats = graph.stats();
          if (stats.entities === 0) return;

          const prompt = (event as any).prompt || "";
          let contextLines: string[] = [];
          
          // Priority entity types (most useful for context recall)
          const PRIORITY_TYPES = ['Project', 'Person', 'Platform', 'Organization', 'Company', 'Event', 'System'];
          const SKIP_TYPES = ['Tool', 'Concept', 'File', 'Award'];
          
          // Search graph for entities relevant to current prompt
          if (prompt && prompt.length > 20) {
            const searchQuery = prompt.slice(0, 100).replace(/[\n\r]+/g, ' ').trim();
            const results = graph.search(searchQuery, 15); // Get more results to filter from
            if (results.length > 0) {
              const filtered = results
                .filter((r: any) => !SKIP_TYPES.includes(r.entity.type))
                .sort((a: any, b: any) => {
                  // Sort by priority type first, then by relationship count
                  const aPriority = PRIORITY_TYPES.indexOf(a.entity.type);
                  const bPriority = PRIORITY_TYPES.indexOf(b.entity.type);
                  const aScore = (aPriority >= 0 ? 100 - aPriority : 50) + (a.relations?.length || 0);
                  const bScore = (bPriority >= 0 ? 100 - bPriority : 50) + (b.relations?.length || 0);
                  return bScore - aScore;
                })
                .slice(0, 5);
              
              if (filtered.length > 0) {
                contextLines = filtered.map((r: any) => {
                  const rels = r.relations
                    ?.filter((rel: any) => !SKIP_TYPES.includes(rel.targetType || ''))
                    .slice(0, 3)
                    .map((rel: any) => `${rel.direction === 'outgoing' ? '→' : '←'} ${rel.relation} ${rel.target}`)
                    .join(', ') || '';
                  return `${r.entity.name} (${r.entity.type})${rels ? ': ' + rels : ''}`;
                });
              }
            }
          }

          // Fallback: get most connected non-skip entities
          if (contextLines.length === 0) {
            const allEntities = graph.listEntities({ limit: 30, sortBy: 'updated_at' });
            const prioritized = allEntities
              .filter((e: any) => !SKIP_TYPES.includes(e.type))
              .sort((a: any, b: any) => {
                const aPriority = PRIORITY_TYPES.indexOf(a.type);
                const bPriority = PRIORITY_TYPES.indexOf(b.type);
                return (bPriority >= 0 ? bPriority : -1) - (aPriority >= 0 ? aPriority : -1);
              })
              .slice(0, 5);
            
            if (prioritized.length > 0) {
              contextLines = prioritized.map((e: any) => `${e.name} (${e.type})`);
            }
          }

          if (contextLines.length === 0) return;

          const injection = `## Knowledge Graph Context (auto-injected by memory-graph plugin)\nRelevant entities from your knowledge graph:\n${contextLines.join('\n')}\n\nUse memory_graph_query or memory_graph_search tools for more details when needed.`;

          return { appendContext: injection };
        } catch (err) {
          console.warn("[memory-graph] Prompt injection failed:", (err as Error).message);
          return;
        }
      },
      { priority: 10 },
    );

    // ─── Hook: Auto-ingest on every inbound message ─────────────
    api.on(
      "message_received",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.autoIngest === false) return;

        // event.content IS the message text (string), not an object
        const text = typeof event.content === 'string' ? event.content : (event.content?.text || event.content?.body || "");
        
        if (!text || !shouldIngest(text)) return;

        // Track message for session summary
        const sessionKey = event.sessionKey || "";
        if (sessionKey) {
          if (!sessionMessages.has(sessionKey)) sessionMessages.set(sessionKey, []);
          const msgs = sessionMessages.get(sessionKey)!;
          msgs.push({ text, role: "user", timestamp: Date.now() });
          // Rolling window: keep only last N messages
          if (msgs.length > SESSION_SUMMARY_MAX_BUFFER) msgs.shift();
        }

        // Batch mode: buffer messages and flush after window or max count
        messageBuffer.push({
          text,
          senderId: event.senderId || "unknown",
          sessionKey: sessionKey,
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

    // ─── Hook: Track assistant messages for session summary ─────
    api.on(
      "message_sent",
      async (event) => {
        const config = (event as any).context?.pluginConfig;
        if (config?.sessionSummary === false) return;

        const text = typeof event.content === 'string' ? event.content : ((event as any).content?.text || "");
        const sessionKey = (event as any).sessionKey || "";
        if (!text || !sessionKey || text.length < MIN_MEANINGFUL_LENGTH) return;

        if (!sessionMessages.has(sessionKey)) sessionMessages.set(sessionKey, []);
        const msgs = sessionMessages.get(sessionKey)!;
        msgs.push({ text: text.slice(0, 500), role: "assistant", timestamp: Date.now() });
        if (msgs.length > SESSION_SUMMARY_MAX_BUFFER) msgs.shift();
      },
      { priority: 10 },
    );

    // ─── Hook: agent_end — capture full turn messages for summary ─────
    api.on(
      "agent_end",
      async (event, ctx) => {
        const config = (ctx as any)?.pluginConfig;
        const sessionKey = (ctx as any)?.sessionKey || "";
        const messages = (event as any).messages || [];
        console.log(`[memory-graph] agent_end fired: sessionKey=${sessionKey}, messages=${messages.length}, success=${(event as any).success}`);
        
        if (config?.sessionSummary === false) return;
        if (!sessionKey) return;

        // Extract meaningful text from messages
        const textParts: string[] = [];
        for (const msg of messages) {
          const role = msg.role || "unknown";
          if (role !== "user" && role !== "assistant") continue;
          const text = typeof msg.content === 'string' 
            ? msg.content 
            : (Array.isArray(msg.content) 
              ? msg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ')
              : "");
          if (!text || text.length < MIN_MEANINGFUL_LENGTH) continue;
          textParts.push(`[${role}]: ${text.slice(0, 500)}`);
        }

        // Need at least 2 meaningful messages (user + assistant)
        if (textParts.length < 2) return;

        // Build transcript from agent_end messages directly
        const transcript = textParts.join('\n').slice(0, 3000);

        try {
          const graph = await getGraph(config);

          const { OpenAI } = await import('openai');
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL,
          });

          const summaryResponse = await client.chat.completions.create({
            model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
            messages: [
              {
                role: "system",
                content: `You are a session summarizer for a knowledge graph. Given a conversation transcript, extract a 2-4 sentence summary of KEY ACTIONS taken (what was built, fixed, published, decided, configured). Focus on concrete outcomes, versions, platforms, and decisions. Skip casual chat and test/debug noise. If nothing meaningful happened, respond with "NO_SUMMARY". Output plain text only.`,
              },
              { role: "user", content: transcript },
            ],
            max_tokens: 300,
            temperature: 0.3,
          });

          const summary = summaryResponse.choices?.[0]?.message?.content?.trim();
          if (summary && summary !== "NO_SUMMARY" && summary.length >= 20) {
            const today = new Date().toISOString().split('T')[0];
            await graph.ingest(summary, { source: `session-summary-${today}`, sessionId: sessionKey });
            console.log(`[memory-graph] Session summary ingested (${textParts.length} msgs → ${summary.length} chars)`);
          } else {
            console.log(`[memory-graph] No meaningful summary for session (${textParts.length} msgs)`);
          }
        } catch (err) {
          console.warn("[memory-graph] Session summary failed:", (err as Error).message);
        }
      },
      { priority: 10 },
    );

    // ─── Hook: Session end — summarize & ingest ─────────────────
    api.on(
      "session_end",
      async (event, ctx) => {
        const config = (ctx as any)?.pluginConfig;
        if (config?.sessionSummary === false) return;

        const sessionKey = (event as any).sessionKey || (event as any).sessionId || "";
        const msgs = sessionMessages.get(sessionKey);
        
        // Cleanup buffer regardless
        sessionMessages.delete(sessionKey);

        if (!msgs || msgs.length < SESSION_SUMMARY_MIN_MESSAGES) return;

        try {
          const graph = await getGraph(config);
          
          // Build a condensed transcript for summarization
          const transcript = msgs
            .map(m => `[${m.role}]: ${m.text}`)
            .join('\n')
            .slice(0, 3000); // Cap at 3000 chars for LLM input

          // Use LLM to generate a structured summary
          const { OpenAI } = await import('openai');
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL,
          });

          const summaryResponse = await client.chat.completions.create({
            model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
            messages: [
              {
                role: "system",
                content: `You are a session summarizer for a knowledge graph. Given a conversation transcript, extract a 2-4 sentence summary of KEY ACTIONS taken (what was built, fixed, published, decided, configured). Focus on concrete outcomes, versions, platforms, and decisions. Skip casual chat. If nothing meaningful happened, respond with "NO_SUMMARY". Output plain text only.`,
              },
              {
                role: "user",
                content: transcript,
              },
            ],
            max_tokens: 300,
            temperature: 0.3,
          });

          const summary = summaryResponse.choices?.[0]?.message?.content?.trim();
          if (!summary || summary === "NO_SUMMARY" || summary.length < 20) return;

          // Ingest the summary into the graph
          const today = new Date().toISOString().split('T')[0];
          await graph.ingest(summary, {
            source: `session-summary-${today}`,
            sessionId: sessionKey,
          });

          console.log(`[memory-graph] Session summary ingested (${msgs.length} messages → ${summary.length} chars)`);
        } catch (err) {
          console.warn("[memory-graph] Session summary ingestion failed:", (err as Error).message);
        }
      },
      { priority: 10 },
    );

    // ─── Hook: Cleanup on gateway stop ──────────────────────────
    api.on("gateway_stop", async () => {
      // Flush any remaining session summaries
      for (const [key, msgs] of sessionMessages.entries()) {
        if (msgs.length >= SESSION_SUMMARY_MIN_MESSAGES) {
          try {
            const graph = await getGraph(null);
            const transcript = msgs.map(m => `[${m.role}]: ${m.text}`).join('\n').slice(0, 3000);
            const today = new Date().toISOString().split('T')[0];
            await graph.ingest(`Session ended during shutdown. Messages: ${transcript.slice(0, 500)}`, {
              source: `session-summary-${today}-shutdown`,
              sessionId: key,
            });
          } catch (_) { /* best effort */ }
        }
      }
      sessionMessages.clear();

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
      description: "Show knowledge graph statistics: entity count, relationship count, types, temporal/lifecycle info.",
      parameters: Type.Object({}),
      async execute(_id, _params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const stats = graph.stats();

        return {
          content: [
            {
              type: "text",
              text: [
                `Entities: ${stats.entities} (stale: ${stats.staleEntities || 0})`,
                `Relationships: ${stats.relationships} (active: ${stats.activeRelationships || stats.relationships}, superseded: ${stats.supersededRelationships || 0})`,
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

    // ─── Tool: Temporal Query ────────────────────────────────────
    api.registerTool({
      name: "memory_graph_temporal",
      description:
        "Query the knowledge graph at a specific point in time. Shows what facts were true at that moment. Graphiti-inspired temporal awareness.",
      parameters: Type.Object({
        entity: Type.String({ description: "Entity name to query" }),
        at: Type.Optional(Type.String({ description: "ISO timestamp to query at (default: now)" })),
        includeSuperseded: Type.Optional(Type.Number({ description: "Set to 1 to include invalidated/superseded facts" })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const engine = graph.getEngine();
        const atTime = params.at || new Date().toISOString();
        const includeAll = params.includeSuperseded === 1;

        const entity = engine.findEntityByName(params.entity);
        if (!entity) {
          return { content: [{ type: "text", text: `Entity "${params.entity}" not found.` }] };
        }

        // Touch entity for access tracking
        engine.touchEntity(entity.id);

        const activeRels = engine.getRelationsAtTime(params.entity, atTime);
        const lines = activeRels.map((r: any) => 
          `→ ${r.relation} ${r.to_name} (confidence: ${(r.confidence * 100).toFixed(0)}%, valid from: ${r.valid_from || 'unknown'}${r.valid_until ? ', until: ' + r.valid_until : ''})`
        );

        let supersededLines: string[] = [];
        if (includeAll) {
          const allRels = engine.getRelationsFrom(entity.id, true);
          const superseded = allRels.filter((r: any) => r.lifecycle === 'superseded' || r.valid_until);
          supersededLines = superseded.map((r: any) =>
            `✗ ${r.relation} ${r.to_name} (superseded, was valid: ${r.valid_from || '?'} → ${r.valid_until || '?'})`
          );
        }

        const output = [
          `Entity: ${entity.name} (${entity.type}) [confidence: ${(entity.confidence * 100).toFixed(0)}%, lifecycle: ${entity.lifecycle || 'active'}]`,
          `Facts at ${atTime}:`,
          ...lines,
          ...(supersededLines.length > 0 ? ['\nSuperseded facts:', ...supersededLines] : []),
        ];

        return { content: [{ type: "text", text: lines.length > 0 || supersededLines.length > 0 ? output.join('\n') : `No facts found for "${params.entity}" at ${atTime}.` }] };
      },
    });

    // ─── Tool: Supersede ─────────────────────────────────────────
    api.registerTool({
      name: "memory_graph_supersede",
      description:
        "Update a fact by superseding the old one. E.g., 'Alice works at Google' supersedes 'Alice works at Meta'. Old fact is preserved but marked invalid. Graphiti-inspired temporal fact management.",
      parameters: Type.Object({
        entity: Type.String({ description: "Subject entity name" }),
        relation: Type.String({ description: "Relationship type" }),
        oldTarget: Type.String({ description: "Old target entity (being superseded)" }),
        newTarget: Type.String({ description: "New target entity (current truth)" }),
        source: Type.Optional(Type.String({ description: "Source label" })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const engine = graph.getEngine();
        const result = engine.supersedeRelation(
          params.entity,
          params.relation,
          params.oldTarget,
          params.newTarget,
          { source: params.source || 'manual-supersede' }
        );

        const invalidatedMsg = result.invalidated
          ? `Invalidated: ${params.entity} -[${params.relation}]-> ${params.oldTarget}`
          : `No existing active relation found to invalidate.`;

        return {
          content: [{
            type: "text",
            text: `${invalidatedMsg}\nCreated: ${params.entity} -[${params.relation}]-> ${params.newTarget} (confidence: ${(result.created.confidence * 100).toFixed(0)}%)`,
          }],
        };
      },
    });

    // ─── Tool: Decay ─────────────────────────────────────────────
    api.registerTool({
      name: "memory_graph_decay",
      description:
        "Apply confidence decay to stale entities and relationships. Older, unaccessed items lose confidence. Run periodically to keep the graph fresh.",
      parameters: Type.Object({
        decayRate: Type.Optional(Type.Number({ description: "Decay amount per cycle (default 0.01)" })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const engine = graph.getEngine();
        const result = engine.applyConfidenceDecay(params.decayRate || 0.01);

        return {
          content: [{
            type: "text",
            text: `Decay applied. Entities affected: ${result.entitiesDecayed}, Relationships affected: ${result.relsDecayed}`,
          }],
        };
      },
    });

    // ─── Tool: Semantic Search ─────────────────────────────────
    api.registerTool({
      name: "memory_graph_semantic_search",
      description:
        "Semantic/vector search for entities similar to a query. Uses embeddings for meaning-based matching (not just keywords). Requires embeddings to be generated first.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query (natural language)" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const db = graph.getDb();
        const results = await semanticSearch(db, params.query, { limit: params.limit || 10 });

        if (results.length === 0) {
          return { content: [{ type: "text", text: `No semantic matches for "${params.query}". Run memory_graph_embed to generate embeddings first.` }] };
        }

        const text = results.map(r =>
          `${r.entity_name} (${r.entity_type}) [similarity: ${(r.similarity * 100).toFixed(1)}%]`
        ).join('\n');

        return { content: [{ type: "text", text }] };
      },
    });

    // ─── Tool: Embed Entities ──────────────────────────────────
    api.registerTool({
      name: "memory_graph_embed",
      description:
        "Generate embeddings for entities that don't have them yet. Required for semantic search. Processes in batches.",
      parameters: Type.Object({
        batchSize: Type.Optional(Type.Number({ description: "Entities to embed per call (default 20)" })),
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const db = graph.getDb();
        const config = ctx?.pluginConfig;
        const model = config?.embeddingModel || 'text-embedding-3-small';
        const count = await embedMissingEntities(db, { model, batchSize: params.batchSize || 20 });

        return {
          content: [{
            type: "text",
            text: count > 0
              ? `Embedded ${count} entities. Run again if more remain.`
              : `All entities already have embeddings.`,
          }],
        };
      },
    });

    // ─── Tool: Relation Dedup ──────────────────────────────────
    api.registerTool({
      name: "memory_graph_dedup_relations",
      description:
        "Clean up the knowledge graph by normalizing relation types (synonyms → canonical form), removing vague relations, and merging duplicates. Run once after upgrade to v0.7.0.",
      parameters: Type.Object({}),
      async execute(_id, _params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const db = graph.getDb();
        const result = dedupRelations(db);

        return {
          content: [{
            type: "text",
            text: [
              `Relations normalized: ${result.normalized}`,
              `Relations removed (vague/duplicate): ${result.removed}`,
              `Merge groups: ${result.mergedRelations.length}`,
              result.mergedRelations.length > 0
                ? `Top merges: ${result.mergedRelations.slice(0, 5).map(m => `${m.count} duplicates`).join(', ')}`
                : '',
            ].filter(Boolean).join('\n'),
          }],
        };
      },
    });
  },
});
