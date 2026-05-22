import { z } from 'zod';
/** Domain hint for improving extraction accuracy */
const DomainSchema = z.object({
    name: z.string(),
    entityHints: z.array(z.string()).default([]),
    relationHints: z.array(z.string()).default([]),
});
/** Sync configuration */
const SyncSchema = z.object({
    memoryMd: z.string().nullable().default(null),
    neuralMemory: z.string().nullable().default(null),
    importOnStart: z.boolean().default(false),
});
/** Full config schema */
export const ConfigSchema = z.object({
    storage: z.object({
        path: z.string().default('./memory-graph.db'),
        maxSizeMb: z.number().default(500),
    }).default({}),
    extraction: z.object({
        provider: z.enum(['auto', 'openai', 'anthropic', 'ollama']).default('auto'),
        model: z.string().default('auto'),
        autoExtract: z.boolean().default(true),
        minConfidence: z.number().min(0).max(1).default(0.7),
        batchSize: z.number().default(5),
    }).default({}),
    domains: z.array(DomainSchema).default([]),
    deduplication: z.object({
        enabled: z.boolean().default(true),
        similarityThreshold: z.number().min(0).max(1).default(0.85),
    }).default({}),
    sync: SyncSchema.default({}),
    query: z.object({
        maxHops: z.number().default(5),
        maxResults: z.number().default(50),
        includeConfidence: z.boolean().default(true),
    }).default({}),
});
//# sourceMappingURL=schema.js.map