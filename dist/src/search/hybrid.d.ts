import type { Config } from '../config/schema.js';
import { GraphEngine } from '../graph/engine.js';
export interface SearchResult {
    entity: {
        id: string;
        name: string;
        type: string;
        properties: Record<string, unknown>;
    };
    relations: Array<{
        direction: 'outgoing' | 'incoming';
        relation: string;
        target: string;
        targetType: string;
    }>;
    score?: number;
}
/**
 * Hybrid search: combines FTS + graph context.
 */
export declare function hybridSearch(engine: GraphEngine, query: string, config: Config): SearchResult[];
//# sourceMappingURL=hybrid.d.ts.map