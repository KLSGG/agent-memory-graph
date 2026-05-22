import type { Config, Domain } from '../config/schema.js';

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
 * Build the extraction prompt based on config and optional domain hints.
 */
function buildPrompt(text: string, domains: Domain[]): string {
  const domainContext = domains.length > 0
    ? `\nDomain hints (use these to improve accuracy):\n${domains.map(d =>
        `- ${d.name}: entities=[${d.entityHints.join(', ')}], relations=[${d.relationHints.join(', ')}]`
      ).join('\n')}\n`
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
function detectProvider(config: Config): 'openai' | 'anthropic' | 'ollama' | null {
  if (config.extraction.provider !== 'auto') {
    return config.extraction.provider;
  }

  // Auto-detect based on available env vars
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OLLAMA_HOST || process.env.OLLAMA_URL) return 'ollama';

  return null;
}

/**
 * Call OpenAI-compatible API for extraction.
 */
async function callOpenAI(prompt: string, model: string): Promise<string> {
  const { default: OpenAI } = await import('openai') as any;
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
async function callAnthropic(prompt: string, model: string): Promise<string> {
  // @ts-ignore — optional peer dependency
  const { default: Anthropic } = await import('@anthropic-ai/sdk') as any;
  const client = new Anthropic();

  const response = await client.messages.create({
    model: model === 'auto' ? 'claude-3-5-haiku-20241022' : model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0] as any;
  return block.type === 'text' ? block.text : '{"entities":[],"relationships":[]}';
}

/**
 * Call Ollama for extraction (local LLM).
 */
async function callOllama(prompt: string, model: string): Promise<string> {
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

  const data = await response.json() as { response: string };
  return data.response;
}

/**
 * Extract entities and relationships from text using configured LLM.
 */
export async function extractFromText(text: string, config: Config): Promise<ExtractionResult> {
  const provider = detectProvider(config);
  if (!provider) {
    throw new Error(
      'No LLM provider available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_HOST.'
    );
  }

  const prompt = buildPrompt(text, config.domains);
  const model = config.extraction.model;

  let rawResponse: string;

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

    const entities: ExtractedEntity[] = (parsed.entities || [])
      .filter((e: any) => e.name && e.type && (e.confidence ?? 1) >= config.extraction.minConfidence)
      .map((e: any) => ({
        name: String(e.name).trim(),
        type: String(e.type).trim(),
        properties: e.properties ?? {},
        confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.8)),
      }));

    const relationships: ExtractedRelation[] = (parsed.relationships || [])
      .filter((r: any) => r.from && r.relation && r.to && (r.confidence ?? 1) >= config.extraction.minConfidence)
      .map((r: any) => ({
        from: String(r.from).trim(),
        relation: String(r.relation).trim().toUpperCase().replace(/\s+/g, '_'),
        to: String(r.to).trim(),
        fromType: r.fromType?.trim(),
        toType: r.toType?.trim(),
        confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0.8)),
        when: r.when ? String(r.when).trim() : undefined,
      }));

    return { entities, relationships };
  } catch (err) {
    console.warn('[agent-memory-graph] Failed to parse extraction response:', err);
    return { entities: [], relationships: [] };
  }
}
