import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type Config } from './schema.js';

const CONFIG_FILENAME = 'graph.config.json';

/**
 * Load config from file or return defaults.
 * Searches: provided path → ./config/graph.config.json → defaults
 */
export function loadConfig(configPath?: string): Config {
  const paths = configPath
    ? [configPath]
    : [
        resolve(process.cwd(), 'config', CONFIG_FILENAME),
        resolve(process.cwd(), CONFIG_FILENAME),
      ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'));
        return ConfigSchema.parse(raw);
      } catch (err) {
        console.warn(`[agent-memory-graph] Invalid config at ${p}, using defaults.`);
      }
    }
  }

  // Return defaults (zero-config)
  return ConfigSchema.parse({});
}

export { ConfigSchema, type Config };
