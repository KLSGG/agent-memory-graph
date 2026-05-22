import { ConfigSchema, type Config } from './schema.js';
/**
 * Load config from file or return defaults.
 * Searches: provided path → ./config/graph.config.json → defaults
 */
export declare function loadConfig(configPath?: string): Config;
export { ConfigSchema, type Config };
//# sourceMappingURL=defaults.d.ts.map