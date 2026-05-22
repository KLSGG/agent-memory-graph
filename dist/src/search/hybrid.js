/**
 * Hybrid search: combines FTS + graph context.
 */
export function hybridSearch(engine, query, config) {
    const limit = config.query.maxResults;
    // Step 1: FTS search for matching entities
    const entities = engine.searchEntities(query, limit);
    // Step 2: Enrich with relationship context
    const results = entities.map(entity => {
        const outgoing = engine.getRelationsFrom(entity.id);
        const incoming = engine.getRelationsTo(entity.id);
        const relations = [
            ...outgoing.map(r => ({
                direction: 'outgoing',
                relation: r.relation,
                target: r.to_name,
                targetType: r.to_type,
            })),
            ...incoming.map(r => ({
                direction: 'incoming',
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
//# sourceMappingURL=hybrid.js.map