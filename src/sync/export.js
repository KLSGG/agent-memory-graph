/**
 * Export graph to various formats.
 */
export function exportGraph(engine, options) {
    const { format, includeProperties = false, maxEntities = 500 } = options;
    const entities = engine.listEntities({ limit: maxEntities });
    const stats = engine.stats();
    switch (format) {
        case 'json':
            return exportJSON(engine, entities, includeProperties);
        case 'mermaid':
            return exportMermaid(engine, entities);
        case 'dot':
            return exportDOT(engine, entities);
        case 'csv':
            return exportCSV(engine, entities);
        default:
            throw new Error(`Unsupported export format: ${format}`);
    }
}
function exportJSON(engine, entities, includeProperties) {
    const nodes = entities.map(e => ({
        id: e.id,
        name: e.name,
        type: e.type,
        ...(includeProperties ? { properties: e.properties } : {}),
        confidence: e.confidence,
        created_at: e.created_at,
    }));
    const edges = [];
    for (const entity of entities) {
        const rels = engine.getRelationsFrom(entity.id);
        for (const rel of rels) {
            edges.push({
                from: entity.name,
                to: rel.to_name,
                relation: rel.relation,
                confidence: rel.confidence,
            });
        }
    }
    return JSON.stringify({ nodes, edges, stats: engine.stats() }, null, 2);
}
function exportMermaid(engine, entities) {
    const lines = ['graph LR'];
    const nodeIds = new Map();
    // Assign short IDs for Mermaid
    entities.forEach((e, i) => {
        const shortId = `n${i}`;
        nodeIds.set(e.id, shortId);
        // Shape by type
        const shape = getNodeShape(e.type);
        lines.push(`  ${shortId}${shape[0]}"${escapeMermaid(e.name)}"${shape[1]}`);
    });
    // Add edges
    for (const entity of entities) {
        const rels = engine.getRelationsFrom(entity.id);
        for (const rel of rels) {
            const fromId = nodeIds.get(entity.id);
            const toId = nodeIds.get(rel.to_id);
            if (fromId && toId) {
                lines.push(`  ${fromId} -->|${escapeMermaid(rel.relation)}| ${toId}`);
            }
        }
    }
    return lines.join('\n');
}
function exportDOT(engine, entities) {
    const lines = [
        'digraph MemoryGraph {',
        '  rankdir=LR;',
        '  node [shape=box, style=rounded];',
        '',
    ];
    // Nodes
    for (const entity of entities) {
        const label = `${entity.name}\\n(${entity.type})`;
        lines.push(`  "${entity.id}" [label="${escapeDOT(label)}"];`);
    }
    lines.push('');
    // Edges
    for (const entity of entities) {
        const rels = engine.getRelationsFrom(entity.id);
        for (const rel of rels) {
            lines.push(`  "${entity.id}" -> "${rel.to_id}" [label="${escapeDOT(rel.relation)}"];`);
        }
    }
    lines.push('}');
    return lines.join('\n');
}
function exportCSV(engine, entities) {
    const lines = ['from_name,from_type,relation,to_name,to_type,confidence'];
    for (const entity of entities) {
        const rels = engine.getRelationsFrom(entity.id);
        for (const rel of rels) {
            lines.push(`"${entity.name}","${entity.type}","${rel.relation}","${rel.to_name}","${rel.to_type}",${rel.confidence}`);
        }
    }
    return lines.join('\n');
}
// ─── Helpers ─────────────────────────────────────────────────────
function getNodeShape(type) {
    switch (type.toLowerCase()) {
        case 'person': return ['((', '))']; // Circle
        case 'project': return ['[/', '/]']; // Parallelogram
        case 'tool':
        case 'technology': return ['{{', '}}']; // Hexagon
        default: return ['[', ']']; // Rectangle
    }
}
function escapeMermaid(text) {
    return text.replace(/"/g, "'").replace(/[[\]{}()]/g, '');
}
function escapeDOT(text) {
    return text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
