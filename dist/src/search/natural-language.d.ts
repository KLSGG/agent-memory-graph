import type { Config } from '../config/schema.js';
import { GraphEngine } from '../graph/engine.js';
export interface NLQueryResult {
    answer: string;
    entities: Array<{
        name: string;
        type: string;
    }>;
    paths?: Array<{
        path: string[];
        relations: string[];
    }>;
    confidence: number;
}
/**
 * Translate a natural language question into graph operations and return an answer.
 * Uses pattern matching for common queries, falls back to entity-name extraction.
 */
export declare function naturalLanguageQuery(question: string, engine: GraphEngine, config: Config): Promise<NLQueryResult>;
//# sourceMappingURL=natural-language.d.ts.map