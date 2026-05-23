import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolve } from "node:path";
import { homedir } from "node:os";
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.MEMORY_GRAPH_API_KEY || "sk-local";
}
if (!process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL = process.env.MEMORY_GRAPH_BASE_URL || "http://127.0.0.1:20128/v1";
}
const Type = {
  Object: (props) => ({ type: "object", properties: props, required: Object.keys(props).filter((k) => !props[k]._optional) }),
  String: (opts) => ({ type: "string", ...opts }),
  Number: (opts) => ({ type: "number", ...opts }),
  Optional: (schema) => ({ ...schema, _optional: true })
};
let graphInstance = null;
function getDbPath(config) {
  const raw = config?.dbPath || "~/.openclaw/data/memory-graph.db";
  return raw.startsWith("~") ? resolve(homedir(), raw.slice(2)) : resolve(raw);
}
async function getGraph(config) {
  if (!graphInstance) {
    const { MemoryGraph } = await import("../src/index.js");
    graphInstance = new MemoryGraph({
      path: getDbPath(config),
      config: {
        extraction: {
          provider: "openai",
          model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
          autoExtract: true,
          minConfidence: config?.minConfidence ?? 0.7,
          batchSize: 5
        },
        domains: config?.domains ?? [],
        query: {
          maxHops: config?.maxHops ?? 3,
          maxResults: 10,
          includeConfidence: true
        }
      }
    });
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "sk-local";
    }
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = "http://127.0.0.1:20128/v1";
    }
  }
  return graphInstance;
}
const messageBuffer = [];
let batchTimer = null;
const BATCH_WINDOW_MS = 15e3;
const BATCH_MAX_MESSAGES = 5;
const sessionMessages = /* @__PURE__ */ new Map();
const SESSION_SUMMARY_MIN_MESSAGES = 5;
const SESSION_SUMMARY_MAX_BUFFER = 50;
async function flushBatch(config) {
  if (messageBuffer.length === 0) return;
  const batch = messageBuffer.splice(0, messageBuffer.length);
  const combinedText = batch.map((m) => m.text).join("\n");
  const source = `chat:${batch[0].senderId}`;
  const sessionKey = batch[0].sessionKey;
  try {
    const graph = await getGraph(config);
    await graph.ingest(combinedText, { source, sessionId: sessionKey });
  } catch (err) {
    console.warn("[memory-graph] Batch ingest failed:", err.message);
  }
}
const COMMAND_PATTERNS = /^\s*[\/!](new|reset|status|help|start|stop|restart|approve|elevated|exec|reasoning|model|clear)\b/i;
const TOKEN_PATTERNS = /(?:npm_|clh_|ghp_|gho_|sk-|xox[bpas]-|Bearer\s+|token[:\s]+\S{20,}|[A-Za-z0-9_-]{40,})/;
const CASUAL_PATTERNS = /^\s*(ok|oke|okie|oki|yes|no|yep|nope|sure|đi|đc|dc|ừ|ờ|uh|hmm|hm|ah|oh|wow|nice|cool|good|great|thanks|thx|cảm ơn|sao rồi|sao r|ổn không|ổn k|gà ơi|gà|em ơi|sếp ơi|aira ơi|tiếp|tiếp đi|continue|go|done|xong|rồi|chưa|có|không|ko|k|đúng|sai|được|đc rồi|ok em|ok anh)\s*[?!.]*\s*$/i;
const URL_ONLY_PATTERN = /^\s*(https?:\/\/\S+\s*)+$/;
const MIN_MEANINGFUL_LENGTH = 30;
const MIN_WORD_COUNT = 5;
function shouldIngest(text) {
  if (text.length < MIN_MEANINGFUL_LENGTH) return false;
  if (COMMAND_PATTERNS.test(text)) return false;
  if (TOKEN_PATTERNS.test(text)) return false;
  if (CASUAL_PATTERNS.test(text)) return false;
  if (URL_ONLY_PATTERN.test(text)) return false;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 1).length;
  if (wordCount < MIN_WORD_COUNT) return false;
  return true;
}
var entry_default = definePluginEntry({
  id: "memory-graph",
  name: "Memory Graph",
  description: "Auto-builds a knowledge graph from conversations. Extracts entities/relationships and exposes graph query tools.",
  register(api) {
    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        const config = ctx?.pluginConfig;
        if (config?.promptInjection === false) return;
        try {
          const graph = await getGraph(config);
          const stats = graph.stats();
          if (stats.entities === 0) return;
          const prompt = event.prompt || "";
          let contextLines = [];
          const PRIORITY_TYPES = ["Project", "Person", "Platform", "Organization", "Company", "Event", "System"];
          const SKIP_TYPES = ["Tool", "Concept", "File", "Award"];
          if (prompt && prompt.length > 20) {
            const searchQuery = prompt.slice(0, 100).replace(/[\n\r]+/g, " ").trim();
            const results = graph.search(searchQuery, 15);
            if (results.length > 0) {
              const filtered = results.filter((r) => !SKIP_TYPES.includes(r.entity.type)).sort((a, b) => {
                const aPriority = PRIORITY_TYPES.indexOf(a.entity.type);
                const bPriority = PRIORITY_TYPES.indexOf(b.entity.type);
                const aScore = (aPriority >= 0 ? 100 - aPriority : 50) + (a.relations?.length || 0);
                const bScore = (bPriority >= 0 ? 100 - bPriority : 50) + (b.relations?.length || 0);
                return bScore - aScore;
              }).slice(0, 5);
              if (filtered.length > 0) {
                contextLines = filtered.map((r) => {
                  const rels = r.relations?.filter((rel) => !SKIP_TYPES.includes(rel.targetType || "")).slice(0, 3).map((rel) => `${rel.direction === "outgoing" ? "\u2192" : "\u2190"} ${rel.relation} ${rel.target}`).join(", ") || "";
                  return `${r.entity.name} (${r.entity.type})${rels ? ": " + rels : ""}`;
                });
              }
            }
          }
          if (contextLines.length === 0) {
            const allEntities = graph.listEntities({ limit: 30, sortBy: "updated_at" });
            const prioritized = allEntities.filter((e) => !SKIP_TYPES.includes(e.type)).sort((a, b) => {
              const aPriority = PRIORITY_TYPES.indexOf(a.type);
              const bPriority = PRIORITY_TYPES.indexOf(b.type);
              return (bPriority >= 0 ? bPriority : -1) - (aPriority >= 0 ? aPriority : -1);
            }).slice(0, 5);
            if (prioritized.length > 0) {
              contextLines = prioritized.map((e) => `${e.name} (${e.type})`);
            }
          }
          if (contextLines.length === 0) return;
          const injection = `## Knowledge Graph Context (auto-injected by memory-graph plugin)
Relevant entities from your knowledge graph:
${contextLines.join("\n")}

Use memory_graph_query or memory_graph_search tools for more details when needed.`;
          return { appendContext: injection };
        } catch (err) {
          console.warn("[memory-graph] Prompt injection failed:", err.message);
          return;
        }
      },
      { priority: 10 }
    );
    api.on(
      "message_received",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.autoIngest === false) return;
        const text = typeof event.content === "string" ? event.content : event.content?.text || event.content?.body || "";
        if (!text || !shouldIngest(text)) return;
        const sessionKey = event.sessionKey || "";
        if (sessionKey) {
          if (!sessionMessages.has(sessionKey)) sessionMessages.set(sessionKey, []);
          const msgs = sessionMessages.get(sessionKey);
          msgs.push({ text, role: "user", timestamp: Date.now() });
          if (msgs.length > SESSION_SUMMARY_MAX_BUFFER) msgs.shift();
        }
        messageBuffer.push({
          text,
          senderId: event.senderId || "unknown",
          sessionKey,
          timestamp: Date.now()
        });
        if (messageBuffer.length >= BATCH_MAX_MESSAGES) {
          if (batchTimer) {
            clearTimeout(batchTimer);
            batchTimer = null;
          }
          await flushBatch(config);
          return;
        }
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = setTimeout(() => {
          batchTimer = null;
          flushBatch(config).catch((err) => {
            console.warn("[memory-graph] Batch flush failed:", err.message);
          });
        }, BATCH_WINDOW_MS);
      },
      { priority: 10 }
    );
    api.on(
      "message_sent",
      async (event) => {
        const config = event.context?.pluginConfig;
        if (config?.sessionSummary === false) return;
        const text = typeof event.content === "string" ? event.content : event.content?.text || "";
        const sessionKey = event.sessionKey || "";
        if (!text || !sessionKey || text.length < MIN_MEANINGFUL_LENGTH) return;
        if (!sessionMessages.has(sessionKey)) sessionMessages.set(sessionKey, []);
        const msgs = sessionMessages.get(sessionKey);
        msgs.push({ text: text.slice(0, 500), role: "assistant", timestamp: Date.now() });
        if (msgs.length > SESSION_SUMMARY_MAX_BUFFER) msgs.shift();
      },
      { priority: 10 }
    );
    api.on(
      "agent_end",
      async (event, ctx) => {
        const config = ctx?.pluginConfig;
        const sessionKey = ctx?.sessionKey || "";
        const messages = event.messages || [];
        console.log(`[memory-graph] agent_end fired: sessionKey=${sessionKey}, messages=${messages.length}, success=${event.success}`);
        if (config?.sessionSummary === false) return;
        if (!sessionKey) return;
        const textParts = [];
        for (const msg of messages) {
          const role = msg.role || "unknown";
          if (role !== "user" && role !== "assistant") continue;
          const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join(" ") : "";
          if (!text || text.length < MIN_MEANINGFUL_LENGTH) continue;
          textParts.push(`[${role}]: ${text.slice(0, 500)}`);
        }
        if (textParts.length < 2) return;
        const transcript = textParts.join("\n").slice(0, 3e3);
        try {
          const graph = await getGraph(config);
          const { OpenAI } = await import("openai");
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL
          });
          const summaryResponse = await client.chat.completions.create({
            model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
            messages: [
              {
                role: "system",
                content: `You are a session summarizer for a knowledge graph. Given a conversation transcript, extract a 2-4 sentence summary of KEY ACTIONS taken (what was built, fixed, published, decided, configured). Focus on concrete outcomes, versions, platforms, and decisions. Skip casual chat and test/debug noise. If nothing meaningful happened, respond with "NO_SUMMARY". Output plain text only.`
              },
              { role: "user", content: transcript }
            ],
            max_tokens: 300,
            temperature: 0.3
          });
          const summary = summaryResponse.choices?.[0]?.message?.content?.trim();
          if (summary && summary !== "NO_SUMMARY" && summary.length >= 20) {
            const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
            await graph.ingest(summary, { source: `session-summary-${today}`, sessionId: sessionKey });
            console.log(`[memory-graph] Session summary ingested (${textParts.length} msgs \u2192 ${summary.length} chars)`);
          } else {
            console.log(`[memory-graph] No meaningful summary for session (${textParts.length} msgs)`);
          }
        } catch (err) {
          console.warn("[memory-graph] Session summary failed:", err.message);
        }
      },
      { priority: 10 }
    );
    api.on(
      "session_end",
      async (event, ctx) => {
        const config = ctx?.pluginConfig;
        if (config?.sessionSummary === false) return;
        const sessionKey = event.sessionKey || event.sessionId || "";
        const msgs = sessionMessages.get(sessionKey);
        sessionMessages.delete(sessionKey);
        if (!msgs || msgs.length < SESSION_SUMMARY_MIN_MESSAGES) return;
        try {
          const graph = await getGraph(config);
          const transcript = msgs.map((m) => `[${m.role}]: ${m.text}`).join("\n").slice(0, 3e3);
          const { OpenAI } = await import("openai");
          const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL
          });
          const summaryResponse = await client.chat.completions.create({
            model: config?.extractionModel || process.env.MEMORY_GRAPH_MODEL || "kr/claude-haiku-4.5",
            messages: [
              {
                role: "system",
                content: `You are a session summarizer for a knowledge graph. Given a conversation transcript, extract a 2-4 sentence summary of KEY ACTIONS taken (what was built, fixed, published, decided, configured). Focus on concrete outcomes, versions, platforms, and decisions. Skip casual chat. If nothing meaningful happened, respond with "NO_SUMMARY". Output plain text only.`
              },
              {
                role: "user",
                content: transcript
              }
            ],
            max_tokens: 300,
            temperature: 0.3
          });
          const summary = summaryResponse.choices?.[0]?.message?.content?.trim();
          if (!summary || summary === "NO_SUMMARY" || summary.length < 20) return;
          const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
          await graph.ingest(summary, {
            source: `session-summary-${today}`,
            sessionId: sessionKey
          });
          console.log(`[memory-graph] Session summary ingested (${msgs.length} messages \u2192 ${summary.length} chars)`);
        } catch (err) {
          console.warn("[memory-graph] Session summary ingestion failed:", err.message);
        }
      },
      { priority: 10 }
    );
    api.on("gateway_stop", async () => {
      for (const [key, msgs] of sessionMessages.entries()) {
        if (msgs.length >= SESSION_SUMMARY_MIN_MESSAGES) {
          try {
            const graph = await getGraph(null);
            const transcript = msgs.map((m) => `[${m.role}]: ${m.text}`).join("\n").slice(0, 3e3);
            const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
            await graph.ingest(`Session ended during shutdown. Messages: ${transcript.slice(0, 500)}`, {
              source: `session-summary-${today}-shutdown`,
              sessionId: key
            });
          } catch (_) {
          }
        }
      }
      sessionMessages.clear();
      if (graphInstance) {
        graphInstance.close();
        graphInstance = null;
      }
    });
    api.registerTool({
      name: "memory_graph_query",
      description: "Ask a natural language question against the knowledge graph. Use for relationship questions like 'What does Alice work on?', 'How is X connected to Y?', 'List all projects'.",
      parameters: Type.Object({
        question: Type.String({ description: "Natural language question" })
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const result = await graph.ask(params.question);
        return {
          content: [
            {
              type: "text",
              text: `${result.answer}${result.confidence < 0.5 ? `
(Low confidence: ${(result.confidence * 100).toFixed(0)}%)` : ""}`
            }
          ]
        };
      }
    });
    api.registerTool({
      name: "memory_graph_ingest",
      description: "Manually extract entities and relationships from text and store in the knowledge graph. Use when you want to explicitly add information.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to extract entities from" }),
        source: Type.Optional(Type.String({ description: "Source label" }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const result = await graph.ingest(params.text, { source: params.source || "manual" });
        const entities = result.entities.map((e) => `${e.name} (${e.type})`).join(", ");
        const rels = result.relationships.map((r) => `${r.from} -[${r.relation}]-> ${r.to}`).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Extracted ${result.entities.length} entities: ${entities}
Relationships (${result.relationships.length}): ${rels}`
            }
          ]
        };
      }
    });
    api.registerTool({
      name: "memory_graph_search",
      description: "Search entities in the knowledge graph by keyword or type. Returns matching entities with their relationships.",
      parameters: Type.Object({
        query: Type.String({ description: "Search keyword" }),
        type: Type.Optional(Type.String({ description: "Filter by entity type" })),
        limit: Type.Optional(Type.Number({ description: "Max results", default: 10 }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        if (params.type) {
          const entities = graph.listEntities({ type: params.type, limit: params.limit || 10 });
          const lines2 = entities.map((e) => `${e.name} (${e.type})`);
          return {
            content: [{ type: "text", text: lines2.length > 0 ? lines2.join("\n") : "No entities found." }]
          };
        }
        const results = graph.search(params.query, params.limit || 10);
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No results found." }] };
        }
        const lines = results.map((r) => {
          const rels = r.relations.map((rel) => `${rel.direction === "outgoing" ? "\u2192" : "\u2190"} ${rel.relation} ${rel.target}`).join("; ");
          return `${r.entity.name} (${r.entity.type})${rels ? ": " + rels : ""}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
    });
    api.registerTool({
      name: "memory_graph_path",
      description: "Find the shortest path between two entities in the knowledge graph. Shows how they are connected through relationships.",
      parameters: Type.Object({
        from: Type.String({ description: "Starting entity name" }),
        to: Type.String({ description: "Target entity name" }),
        maxHops: Type.Optional(Type.Number({ description: "Maximum traversal hops", default: 3 }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const path = graph.findPath(params.from, params.to, params.maxHops || 3);
        if (!path) {
          return {
            content: [{ type: "text", text: `No path found between "${params.from}" and "${params.to}".` }]
          };
        }
        const display = path.path.map((node, i) => i < path.relations.length ? `${node} ${path.relations[i]}` : node).join(" ");
        return { content: [{ type: "text", text: `Path: ${display}` }] };
      }
    });
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
                `Newest: ${stats.newestEntry || "(empty)"}`
              ].join("\n")
            }
          ]
        };
      }
    });
    api.registerTool({
      name: "memory_graph_temporal",
      description: "Query the knowledge graph at a specific point in time. Shows what facts were true at that moment. Graphiti-inspired temporal awareness.",
      parameters: Type.Object({
        entity: Type.String({ description: "Entity name to query" }),
        at: Type.Optional(Type.String({ description: "ISO timestamp to query at (default: now)" })),
        includeSuperseded: Type.Optional(Type.Number({ description: "Set to 1 to include invalidated/superseded facts" }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const engine = graph.getEngine();
        const atTime = params.at || (/* @__PURE__ */ new Date()).toISOString();
        const includeAll = params.includeSuperseded === 1;
        const entity = engine.findEntityByName(params.entity);
        if (!entity) {
          return { content: [{ type: "text", text: `Entity "${params.entity}" not found.` }] };
        }
        engine.touchEntity(entity.id);
        const activeRels = engine.getRelationsAtTime(params.entity, atTime);
        const lines = activeRels.map(
          (r) => `\u2192 ${r.relation} ${r.to_name} (confidence: ${(r.confidence * 100).toFixed(0)}%, valid from: ${r.valid_from || "unknown"}${r.valid_until ? ", until: " + r.valid_until : ""})`
        );
        let supersededLines = [];
        if (includeAll) {
          const allRels = engine.getRelationsFrom(entity.id, true);
          const superseded = allRels.filter((r) => r.lifecycle === "superseded" || r.valid_until);
          supersededLines = superseded.map(
            (r) => `\u2717 ${r.relation} ${r.to_name} (superseded, was valid: ${r.valid_from || "?"} \u2192 ${r.valid_until || "?"})`
          );
        }
        const output = [
          `Entity: ${entity.name} (${entity.type}) [confidence: ${(entity.confidence * 100).toFixed(0)}%, lifecycle: ${entity.lifecycle || "active"}]`,
          `Facts at ${atTime}:`,
          ...lines,
          ...supersededLines.length > 0 ? ["\nSuperseded facts:", ...supersededLines] : []
        ];
        return { content: [{ type: "text", text: lines.length > 0 || supersededLines.length > 0 ? output.join("\n") : `No facts found for "${params.entity}" at ${atTime}.` }] };
      }
    });
    api.registerTool({
      name: "memory_graph_supersede",
      description: "Update a fact by superseding the old one. E.g., 'Alice works at Google' supersedes 'Alice works at Meta'. Old fact is preserved but marked invalid. Graphiti-inspired temporal fact management.",
      parameters: Type.Object({
        entity: Type.String({ description: "Subject entity name" }),
        relation: Type.String({ description: "Relationship type" }),
        oldTarget: Type.String({ description: "Old target entity (being superseded)" }),
        newTarget: Type.String({ description: "New target entity (current truth)" }),
        source: Type.Optional(Type.String({ description: "Source label" }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const engine = graph.getEngine();
        const result = engine.supersedeRelation(
          params.entity,
          params.relation,
          params.oldTarget,
          params.newTarget,
          { source: params.source || "manual-supersede" }
        );
        const invalidatedMsg = result.invalidated ? `Invalidated: ${params.entity} -[${params.relation}]-> ${params.oldTarget}` : `No existing active relation found to invalidate.`;
        return {
          content: [{
            type: "text",
            text: `${invalidatedMsg}
Created: ${params.entity} -[${params.relation}]-> ${params.newTarget} (confidence: ${(result.created.confidence * 100).toFixed(0)}%)`
          }]
        };
      }
    });
    api.registerTool({
      name: "memory_graph_decay",
      description: "Apply confidence decay to stale entities and relationships. Older, unaccessed items lose confidence. Run periodically to keep the graph fresh.",
      parameters: Type.Object({
        decayRate: Type.Optional(Type.Number({ description: "Decay amount per cycle (default 0.01)" }))
      }),
      async execute(_id, params, ctx) {
        const graph = await getGraph(ctx?.pluginConfig);
        const engine = graph.getEngine();
        const result = engine.applyConfidenceDecay(params.decayRate || 0.01);
        return {
          content: [{
            type: "text",
            text: `Decay applied. Entities affected: ${result.entitiesDecayed}, Relationships affected: ${result.relsDecayed}`
          }]
        };
      }
    });
  }
});
export {
  entry_default as default
};
