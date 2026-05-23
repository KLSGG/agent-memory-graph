/**
 * MCP (Model Context Protocol) server for agent-memory-graph.
 * Exposes graph tools via stdio MCP protocol so external clients
 * (Claude Code, Cursor, Gemini CLI, etc.) can use the knowledge graph.
 *
 * Usage: node dist/mcp/server.js [--db-path <path>]
 */
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
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}
export declare class MCPServer {
    private engine;
    private dbPath;
    constructor(dbPath?: string);
    /** List available tools (MCP tools/list) */
    listTools(): {
        tools: ({
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    query: {
                        type: string;
                        description: string;
                    };
                    type: {
                        type: string;
                        description: string;
                    };
                    limit: {
                        type: string;
                        description: string;
                    };
                    question?: undefined;
                    text?: undefined;
                    source?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    entity?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required: string[];
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    question: {
                        type: string;
                        description: string;
                    };
                    query?: undefined;
                    type?: undefined;
                    limit?: undefined;
                    text?: undefined;
                    source?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    entity?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required: string[];
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    text: {
                        type: string;
                        description: string;
                    };
                    source: {
                        type: string;
                        description: string;
                    };
                    query?: undefined;
                    type?: undefined;
                    limit?: undefined;
                    question?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    entity?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required: string[];
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    from: {
                        type: string;
                        description: string;
                    };
                    to: {
                        type: string;
                        description: string;
                    };
                    maxHops: {
                        type: string;
                        description: string;
                    };
                    query?: undefined;
                    type?: undefined;
                    limit?: undefined;
                    question?: undefined;
                    text?: undefined;
                    source?: undefined;
                    entity?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required: string[];
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    query?: undefined;
                    type?: undefined;
                    limit?: undefined;
                    question?: undefined;
                    text?: undefined;
                    source?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    entity?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required?: undefined;
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    entity: {
                        type: string;
                        description: string;
                    };
                    at: {
                        type: string;
                        description: string;
                    };
                    includeSuperseded: {
                        type: string;
                        description: string;
                    };
                    query?: undefined;
                    type?: undefined;
                    limit?: undefined;
                    question?: undefined;
                    text?: undefined;
                    source?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required: string[];
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    entity: {
                        type: string;
                        description: string;
                    };
                    relation: {
                        type: string;
                        description: string;
                    };
                    oldTarget: {
                        type: string;
                        description: string;
                    };
                    newTarget: {
                        type: string;
                        description: string;
                    };
                    source: {
                        type: string;
                        description: string;
                    };
                    query?: undefined;
                    type?: undefined;
                    limit?: undefined;
                    question?: undefined;
                    text?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                };
                required: string[];
            };
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    query: {
                        type: string;
                        description: string;
                    };
                    limit: {
                        type: string;
                        description: string;
                    };
                    type?: undefined;
                    question?: undefined;
                    text?: undefined;
                    source?: undefined;
                    from?: undefined;
                    to?: undefined;
                    maxHops?: undefined;
                    entity?: undefined;
                    at?: undefined;
                    includeSuperseded?: undefined;
                    relation?: undefined;
                    oldTarget?: undefined;
                    newTarget?: undefined;
                };
                required: string[];
            };
        })[];
    };
    /** Execute a tool call */
    callTool(name: string, args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    /** Handle a single MCP JSON-RPC request */
    handleRequest(req: MCPRequest): Promise<MCPResponse>;
    /** Start stdio MCP server */
    start(): void;
}
export {};
//# sourceMappingURL=server.d.ts.map