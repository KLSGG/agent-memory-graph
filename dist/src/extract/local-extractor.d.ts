/**
 * Local rule-based entity/relationship extraction.
 * Zero LLM cost. Uses pattern matching, heuristics, and NER-like rules.
 * Inspired by ICM's approach: extract facts from text using grammar patterns.
 */
import type { ExtractionResult } from './extractor.js';
/**
 * Extract entities and relationships from text using rule-based patterns.
 * Zero LLM cost. Returns lower confidence than LLM extraction.
 */
export declare function localExtract(text: string): ExtractionResult;
/**
 * Determine if text is complex enough to warrant LLM extraction.
 * Used in hybrid mode to decide when to call LLM vs use local only.
 */
export declare function needsLLMExtraction(text: string, localResult: ExtractionResult): boolean;
//# sourceMappingURL=local-extractor.d.ts.map