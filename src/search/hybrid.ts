import type { Config } from '../config/schema.js';
import { GraphEngine } from '../graph/engine.js';

export interface SearchResult {
  entity: {
    id: string;
    name: string;
    type: string;
    properties: Record<string, unknown>;
  };
  relations: Array<{
    direction: 'outgoing' | 'incoming';
    relation: string;
    target: string;
    targetType: string;
  }>;
  score?: number;
}

/**
 * Hybrid search: combines FTS + graph context.
 */
export function hybridSearch(
  engine: GraphEngine,
  query: string,
  config: Config
): SearchResult[] {
  const limit = config.query.maxResults;

  // Step 1: FTS search for matching entities
  const entities = engine.searchEntities(query, limit);

  // Step 2: Enrich with relationship context
  const results: SearchResult[] = entities.map(entity => {
    const outgoing = engine.getRelationsFrom(entity.id);
    const incoming = engine.getRelationsTo(entity.id);

    const relations = [
      ...outgoing.map(r => ({
        direction: 'outgoing' as const,
        relation: r.relation,
        target: r.to_name,
        targetType: r.to_type,
      })),
      ...incoming.map(r => ({
        direction: 'incoming' as const,
        relation: r.relation,
        target: r.from_name,
        targetType: r.from_type,
      })),
    ];

    return {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        properties: entity.properties,
      },
      relations,
    };
  });

  return results;
}
