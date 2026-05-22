import { z } from 'zod';
/** Domain hint for improving extraction accuracy */
declare const DomainSchema: z.ZodObject<{
    name: z.ZodString;
    entityHints: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    relationHints: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    entityHints: string[];
    relationHints: string[];
}, {
    name: string;
    entityHints?: string[] | undefined;
    relationHints?: string[] | undefined;
}>;
/** Full config schema */
export declare const ConfigSchema: z.ZodObject<{
    storage: z.ZodDefault<z.ZodObject<{
        path: z.ZodDefault<z.ZodString>;
        maxSizeMb: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        maxSizeMb: number;
    }, {
        path?: string | undefined;
        maxSizeMb?: number | undefined;
    }>>;
    extraction: z.ZodDefault<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["auto", "openai", "anthropic", "ollama"]>>;
        model: z.ZodDefault<z.ZodString>;
        autoExtract: z.ZodDefault<z.ZodBoolean>;
        minConfidence: z.ZodDefault<z.ZodNumber>;
        batchSize: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: "auto" | "openai" | "anthropic" | "ollama";
        model: string;
        autoExtract: boolean;
        minConfidence: number;
        batchSize: number;
    }, {
        provider?: "auto" | "openai" | "anthropic" | "ollama" | undefined;
        model?: string | undefined;
        autoExtract?: boolean | undefined;
        minConfidence?: number | undefined;
        batchSize?: number | undefined;
    }>>;
    domains: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        entityHints: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        relationHints: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        entityHints: string[];
        relationHints: string[];
    }, {
        name: string;
        entityHints?: string[] | undefined;
        relationHints?: string[] | undefined;
    }>, "many">>;
    deduplication: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        similarityThreshold: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        similarityThreshold: number;
    }, {
        enabled?: boolean | undefined;
        similarityThreshold?: number | undefined;
    }>>;
    sync: z.ZodDefault<z.ZodObject<{
        memoryMd: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        neuralMemory: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        importOnStart: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        memoryMd: string | null;
        neuralMemory: string | null;
        importOnStart: boolean;
    }, {
        memoryMd?: string | null | undefined;
        neuralMemory?: string | null | undefined;
        importOnStart?: boolean | undefined;
    }>>;
    query: z.ZodDefault<z.ZodObject<{
        maxHops: z.ZodDefault<z.ZodNumber>;
        maxResults: z.ZodDefault<z.ZodNumber>;
        includeConfidence: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        maxHops: number;
        maxResults: number;
        includeConfidence: boolean;
    }, {
        maxHops?: number | undefined;
        maxResults?: number | undefined;
        includeConfidence?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    storage: {
        path: string;
        maxSizeMb: number;
    };
    extraction: {
        provider: "auto" | "openai" | "anthropic" | "ollama";
        model: string;
        autoExtract: boolean;
        minConfidence: number;
        batchSize: number;
    };
    domains: {
        name: string;
        entityHints: string[];
        relationHints: string[];
    }[];
    deduplication: {
        enabled: boolean;
        similarityThreshold: number;
    };
    sync: {
        memoryMd: string | null;
        neuralMemory: string | null;
        importOnStart: boolean;
    };
    query: {
        maxHops: number;
        maxResults: number;
        includeConfidence: boolean;
    };
}, {
    storage?: {
        path?: string | undefined;
        maxSizeMb?: number | undefined;
    } | undefined;
    extraction?: {
        provider?: "auto" | "openai" | "anthropic" | "ollama" | undefined;
        model?: string | undefined;
        autoExtract?: boolean | undefined;
        minConfidence?: number | undefined;
        batchSize?: number | undefined;
    } | undefined;
    domains?: {
        name: string;
        entityHints?: string[] | undefined;
        relationHints?: string[] | undefined;
    }[] | undefined;
    deduplication?: {
        enabled?: boolean | undefined;
        similarityThreshold?: number | undefined;
    } | undefined;
    sync?: {
        memoryMd?: string | null | undefined;
        neuralMemory?: string | null | undefined;
        importOnStart?: boolean | undefined;
    } | undefined;
    query?: {
        maxHops?: number | undefined;
        maxResults?: number | undefined;
        includeConfidence?: boolean | undefined;
    } | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
export type Domain = z.infer<typeof DomainSchema>;
export {};
//# sourceMappingURL=schema.d.ts.map