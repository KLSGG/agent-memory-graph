import { normalizeRelation } from './relations.js';
import { localExtract, needsLLMExtraction } from './local-extractor.js';
/**
 * Build the extraction prompt based on config and optional domain hints.
 */
function buildPrompt(text, domains) {
    const domainContext = domains.length > 0
        ? `\nDomain hints (use these to improve accuracy):\n${domains.map(d => `- ${d.name}: entities=[${d.entityHints.join(', ')}], relations=[${d.relationHints.join(', ')}]`).join('\n')}\n`
        : '';
    return `You are an entity and relationship extractor. Given text, extract all meaningful entities and their relationships.

Rules:
1. Extract entities with their most specific type (Person, Project, Tool, Company, Location, Concept, etc.)
2. Extract directional relationships between entities (FROM -[RELATION]-> TO)
3. Be domain-agnostic — work with any topic
4. Assign confidence scores (0.0 to 1.0) based on how explicit the mention is
5. Resolve pronouns to their referents when clearly determinable
6. Do NOT hallucinate entities not mentioned or strongly implied in the text
7. Normalize entity names (capitalize properly, use full names when available)
8. Use UPPER_SNAKE_CASE for relationship types (WORKS_ON, USES, OWNS, etc.)
9. Extract temporal context when mentioned (dates, timeframes, "last year", "in 2024", "recently"). Store as properties: {"when": "2024", "temporal": "joined in 2024"}
10. For relationships with time context, include a "when" property: {"from": "X", "relation": "JOINED", "to": "Y", "when": "2024"}
11. Do NOT extract tokens, API keys, passwords, hashes, or secrets as entities
12. Do NOT extract CLI commands (/new, /reset, /status) as entities
${domainContext}
Return ONLY valid JSON (no markdown, no explanation):
{
  "entities": [
    {"name": "Entity Name", "type": "Type", "properties": {"role": "CTO", "when": "2024"}, "confidence": 0.9}
  ],
  "relationships": [
    {"from": "Entity A", "relation": "RELATION_TYPE", "to": "Entity B", "fromType": "TypeA", "toType": "TypeB", "confidence": 0.85, "when": "optional temporal context"}
  ]
}

If the text contains no meaningful entities or relationships, return:
{"entities": [], "relationships": []}

Text to extract from:
"""
${text}
"""`;
}
/**
 * Detect which LLM provider is available.
 */
function detectProvider(config) {
    if (config.extraction.provider !== 'auto') {
        return config.extraction.provider;
    }
    // Auto-detect based on available env vars
    if (process.env.OPENAI_API_KEY)
        return 'openai';
    if (process.env.ANTHROPIC_API_KEY)
        return 'anthropic';
    if (process.env.OLLAMA_HOST || process.env.OLLAMA_URL)
        return 'ollama';
    return null;
}
/**
 * Call OpenAI-compatible API for extraction.
 */
async function callOpenAI(prompt, model) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || 'sk-local',
        baseURL: process.env.OPENAI_BASE_URL || 'http://127.0.0.1:20128/v1',
    });
    const response = await client.chat.completions.create({
        model: model === 'auto' ? 'gpt-4o-mini' : model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
    });
    return response.choices[0]?.message?.content ?? '{"entities":[],"relationships":[]}';
}
/**
 * Call Anthropic API for extraction.
 */
async function callAnthropic(prompt, model) {
    // @ts-ignore — optional peer dependency
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const response = await client.messages.create({
        model: model === 'auto' ? 'claude-3-5-haiku-20241022' : model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '{"entities":[],"relationships":[]}';
}
/**
 * Call Ollama for extraction (local LLM).
 */
async function callOllama(prompt, model) {
    const host = process.env.OLLAMA_HOST || process.env.OLLAMA_URL || 'http://localhost:11434';
    const response = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model === 'auto' ? 'llama3.1' : model,
            prompt,
            stream: false,
            format: 'json',
        }),
    });
    if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.response;
}
/**
 * Extract entities and relationships from text.
 * Supports 3 modes via config.extraction.mode:
 * - "local": rule-based only (zero API cost)
 * - "llm": always use LLM (best quality, costs tokens)
 * - "hybrid" (default): local first, LLM fallback for complex text
 */
export async function extractFromText(text, config) {
    const mode = config.extraction.mode || 'hybrid';
    // Mode: local only
    if (mode === 'local') {
        return localExtract(text);
    }
    // Mode: hybrid — try local first, LLM only if needed
    if (mode === 'hybrid') {
        const localResult = localExtract(text);
        if (!needsLLMExtraction(text, localResult)) {
            return localResult;
        }
        // Fall through to LLM extraction
        try {
            return await llmExtract(text, config);
        }
        catch (err) {
            // If LLM fails, return local results as fallback
            console.warn('[memory-graph] LLM extraction failed, using local results:', err.message);
            return localResult;
        }
    }
    // Mode: llm (always)
    return llmExtract(text, config);
}
/**
 * LLM-based extraction (original implementation).
 */
async function llmExtract(text, config) {
    const provider = detectProvider(config);
    if (!provider) {
        throw new Error('No LLM provider available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_HOST.');
    }
    const prompt = buildPrompt(text, config.domains);
    const model = config.extraction.model;
    let rawResponse;
    switch (provider) {
        case 'openai':
            rawResponse = await callOpenAI(prompt, model);
            break;
        case 'anthropic':
            rawResponse = await callAnthropic(prompt, model);
            break;
        case 'ollama':
            rawResponse = await callOllama(prompt, model);
            break;
    }
    // Parse response
    try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { entities: [], relationships: [] };
        }
        const parsed = JSON.parse(jsonMatch[0]);
        const entities = (parsed.entities || [])
            .filter((e) => e.name && e.type && (e.confidence ?? 1) >= config.extraction.minConfidence)
            .map((e) => ({
            name: String(e.name).trim(),
            type: String(e.type).trim(),
            properties: e.properties ?? {},
            confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.8)),
        }));
        const relationships = (parsed.relationships || [])
            .filter((r) => r.from && r.relation && r.to && (r.confidence ?? 1) >= config.extraction.minConfidence)
            .map((r) => {
            const rawRelation = String(r.relation).trim().toUpperCase().replace(/\s+/g, '_');
            const normalized = normalizeRelation(rawRelation);
            return normalized ? {
                from: String(r.from).trim(),
                relation: normalized,
                to: String(r.to).trim(),
                fromType: r.fromType?.trim(),
                toType: r.toType?.trim(),
                confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0.8)),
                when: r.when ? String(r.when).trim() : undefined,
            } : null;
        })
            .filter((r) => r !== null);
        return { entities, relationships };
    }
    catch (err) {
        console.warn('[agent-memory-graph] Failed to parse extraction response:', err);
        return { entities: [], relationships: [] };
    }
}
//# sourceMappingURL=extractor.js.map