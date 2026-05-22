import { GraphEngine } from '../graph/engine.js';
import type { Config } from '../config/schema.js';
/**
 * Import entities and relationships from a MEMORY.md file.
 * Splits the file into sections and extracts from each.
 */
export declare function importFromMemoryMd(filePath: string, engine: GraphEngine, config: Config): Promise<{
    entities: number;
    relationships: number;
}>;
/**
 * Import from a directory of markdown files.
 */
export declare function importFromDirectory(dirPath: string, engine: GraphEngine, config: Config): Promise<{
    entities: number;
    relationships: number;
    files: number;
}>;
//# sourceMappingURL=memory-md.d.ts.map