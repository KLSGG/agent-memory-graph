import { GraphEngine } from '../graph/engine.js';
export type ExportFormat = 'json' | 'mermaid' | 'dot' | 'csv';
export interface ExportOptions {
    format: ExportFormat;
    includeProperties?: boolean;
    maxEntities?: number;
}
/**
 * Export graph to various formats.
 */
export declare function exportGraph(engine: GraphEngine, options: ExportOptions): string;
//# sourceMappingURL=export.d.ts.map