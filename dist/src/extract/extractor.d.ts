import type { Config } from '../config/schema.js';
export interface ExtractedEntity {
    name: string;
    type: string;
    properties?: Record<string, unknown>;
    confidence: number;
}
export interface ExtractedRelation {
    from: string;
    relation: string;
    to: string;
    fromType?: string;
    toType?: string;
    confidence: number;
    when?: string;
}
export interface ExtractionResult {
    entities: ExtractedEntity[];
    relationships: ExtractedRelation[];
}
/**
 * Extract entities and relationships from text using configured LLM.
 */
export declare function extractFromText(text: string, config: Config): Promise<ExtractionResult>;
//# sourceMappingURL=extractor.d.ts.map