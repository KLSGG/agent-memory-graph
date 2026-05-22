import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolve } from "node:path";
import { homedir } from "node:os";
// Inline Type helpers (avoid @sinclair/typebox dependency resolution issues)
const Type = {
    Object: (props) => ({ type: "object", properties: props, required: Object.keys(props).filter(k => !props[k]._optional) }),
    String: (opts) => ({ type: "string", ...opts }),
    Number: (opts) => ({ type: "number", ...opts }),
    Optional: (schema) => ({ ...schema, _optional: true }),
};
// Lazy-loaded graph engine to avoid blocking startup
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
                    model: config?.extractionModel || "auto",
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
    }
    return graphInstance;
}
export default definePluginEntry({
    id: "memory-graph",
    name: "Memory Graph",
    description: "Auto-builds a knowledge graph from conversations. Extracts entities/relationships and exposes graph query tools.",
    register(api) {
        // ─── Hook: Auto-ingest on every inbound message ─────────────
        api.on("message_received", async (event) => {
            const config = event.context?.pluginConfig;
            if (config?.autoIngest === false)
                return;
            const text = event.content?.text || event.content?.body || "";
            if (!text || text.length < 15)
                return; // Skip short messages
            try {
                const graph = await getGraph(config);
                await graph.ingest(text, {
                    source: `chat:${event.chatId || "unknown"}`,
                    sessionId: event.sessionId,
                });
            }
            catch (err) {
                // Non-blocking: log but don't fail the message pipeline
                console.warn("[memory-graph] Auto-ingest failed:", err.message);
            }
        }, { priority: 10 });
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
            description: "Ask a natural language question against the knowledge graph. Use for relationship questions like 'What does Alice work on?', 'How is X connected to Y?', 'List all projects'.",
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
            description: "Manually extract entities and relationships from text and store in the knowledge graph. Use when you want to explicitly add information.",
            parameters: Type.Object({
                text: Type.String({ description: "Text to extract entities from" }),
                source: Type.Optional(Type.String({ description: "Source label" })),
            }),
            async execute(_id, params, ctx) {
                const graph = await getGraph(ctx?.pluginConfig);
                const result = await graph.ingest(params.text, { source: params.source || "manual" });
                const entities = result.entities
                    .map((e) => `${e.name} (${e.type})`)
                    .join(", ");
                const rels = result.relationships
                    .map((r) => `${r.from} -[${r.relation}]-> ${r.to}`)
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
            description: "Search entities in the knowledge graph by keyword or type. Returns matching entities with their relationships.",
            parameters: Type.Object({
                query: Type.String({ description: "Search keyword" }),
                type: Type.Optional(Type.String({ description: "Filter by entity type" })),
                limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
            }),
            async execute(_id, params, ctx) {
                const graph = await getGraph(ctx?.pluginConfig);
                if (params.type) {
                    const entities = graph.listEntities({ type: params.type, limit: params.limit || 10 });
                    const lines = entities.map((e) => `${e.name} (${e.type})`);
                    return {
                        content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No entities found." }],
                    };
                }
                const results = graph.search(params.query, params.limit || 10);
                if (results.length === 0) {
                    return { content: [{ type: "text", text: "No results found." }] };
                }
                const lines = results.map((r) => {
                    const rels = r.relations
                        .map((rel) => `${rel.direction === "outgoing" ? "→" : "←"} ${rel.relation} ${rel.target}`)
                        .join("; ");
                    return `${r.entity.name} (${r.entity.type})${rels ? ": " + rels : ""}`;
                });
                return { content: [{ type: "text", text: lines.join("\n") }] };
            },
        });
        // ─── Tool: Path finding ─────────────────────────────────────
        api.registerTool({
            name: "memory_graph_path",
            description: "Find the shortest path between two entities in the knowledge graph. Shows how they are connected through relationships.",
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
                    .map((node, i) => (i < path.relations.length ? `${node} ${path.relations[i]}` : node))
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
//# sourceMappingURL=entry.js.map