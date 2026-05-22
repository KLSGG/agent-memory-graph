/**
 * Translate a natural language question into graph operations and return an answer.
 * Uses pattern matching for common queries, falls back to entity-name extraction.
 */
export async function naturalLanguageQuery(question, engine, config) {
    const q = question.toLowerCase().trim();
    // ─── Pattern: "Where did [entity] work before?" / "Where did X come from?" ───
    const whereDidMatch = q.match(/where (?:did|does|has) (.+?) (?:work|come from|work before|previously work|used to work)/);
    if (whereDidMatch) {
        return queryEntityRelations(engine, whereDidMatch[1].trim(), ['WORKED_AT', 'PREVIOUSLY_WORKED_AT', 'CAME_FROM'], config);
    }
    // ─── Pattern: "What is [entity]'s role?" / "What role does X have?" ───
    const roleMatch = q.match(/what (?:is|are) (.+?)(?:'s|s') (?:role|position|title|job)/);
    if (roleMatch) {
        return queryEntityProperties(engine, roleMatch[1].trim(), ['role', 'position', 'title'], config);
    }
    const roleMatch2 = q.match(/what (?:role|position|title) (?:does|did|is) (.+?) (?:have|hold|play)/);
    if (roleMatch2) {
        return queryEntityProperties(engine, roleMatch2[1].trim(), ['role', 'position', 'title'], config);
    }
    // ─── Pattern: "Who works at [entity]?" / "Who is at [entity]?" ───
    const whoWorksAtMatch = q.match(/who (?:works|is|are|worked) (?:at|for|in) (.+?)(?:\?|$)/);
    if (whoWorksAtMatch) {
        return queryWhoAtEntity(engine, whoWorksAtMatch[1].trim(), config);
    }
    // ─── Pattern: "Who are [entity]'s [noun]?" / "Who are David's clients?" ───
    const whoPossessiveMatch = q.match(/who (?:are|is|were) (.+?)(?:'s|s') (\w+)(?:\?|$)/);
    if (whoPossessiveMatch) {
        return queryAboutEntity(engine, whoPossessiveMatch[1].trim(), config);
    }
    // ─── Pattern: "Who [verb] [entity]?" / "Who suggested pglogical?" ───
    const whoVerbMatch = q.match(/who (\w+(?:ed|s|es)?) (.+?)(?:\?|$)/);
    if (whoVerbMatch) {
        // Try to find the entity and look at incoming relations
        return queryWhoDidEntity(engine, whoVerbMatch[1], whoVerbMatch[2].trim(), config);
    }
    // ─── Pattern: "What am I [relation]?" ───
    const workingOnMatch = q.match(/what (?:am i|do i|are we) (\w+(?:\s+\w+)*?)(?:\?|$)/);
    if (workingOnMatch) {
        return queryByRelationPattern(engine, workingOnMatch[1], config);
    }
    // ─── Pattern: "How is [A] connected to [B]?" ───
    const connectionMatch = q.match(/(?:how is|connection between|relationship between|path from) (.+?) (?:connected to|and|to) (.+?)(?:\?|$)/);
    if (connectionMatch) {
        return queryConnection(engine, connectionMatch[1].trim(), connectionMatch[2].trim(), config);
    }
    // ─── Pattern: "What does [entity] [verb]?" ───
    const whatDoesMatch = q.match(/what (?:does|did|is|are|has) (.+?) (?:work on|use|own|manage|maintain|know|do|build|create|handle|work|run|have|lead|suggest)/);
    if (whatDoesMatch) {
        return queryAboutEntity(engine, whatDoesMatch[1].trim(), config);
    }
    // ─── Pattern: "What [noun] does [entity] [verb]?" ───
    const whatNounMatch = q.match(/what (\w+)s? (?:does|did|do|is|are|has) (.+?) (?:use|own|work on|manage|know|have|build|run|lead|need)/);
    if (whatNounMatch) {
        return queryAboutEntity(engine, whatNounMatch[2].trim(), config);
    }
    // ─── Pattern: "What [noun] is [entity] [verb]ing?" ───
    const whatIsVerbingMatch = q.match(/what ([\w\s]+?) (?:is|are) (.+?) (\w+ing)(?: on| with| at| for)?(?:\?|$)/);
    if (whatIsVerbingMatch) {
        const entityCandidate = whatIsVerbingMatch[2].trim();
        if (entityCandidate && !entityCandidate.match(/^\w+ing$/)) {
            return queryAboutEntity(engine, entityCandidate, config);
        }
    }
    // ─── Pattern: "List all [type]" / "Show me all [type]" ───
    const listMatch = q.match(/(?:list|show|get|find) (?:all |my |every )?(\w+)s?(?:\?|$)/);
    if (listMatch) {
        return queryListType(engine, listMatch[1], config);
    }
    // ─── Pattern: "What [type] are mentioned?" / "What languages are mentioned?" ───
    const whatTypeMentioned = q.match(/what (\w+)s? (?:are|were|is) (?:mentioned|used|listed|included|involved)/);
    if (whatTypeMentioned) {
        return queryListType(engine, whatTypeMentioned[1], config);
    }
    // ─── Pattern: "Tell me about [entity]" / "What is [entity]?" / "Who is [entity]?" ───
    const aboutMatch = q.match(/(?:tell me about|what is|who is|describe|info on|about) (.+?)(?:\?|$)/);
    if (aboutMatch) {
        return queryAboutEntity(engine, aboutMatch[1].trim(), config);
    }
    // ─── Pattern: "[entity]'s [noun]?" ───
    const possessiveMatch = q.match(/([\w\s]+?)(?:'s|s') ([\w\s]+?)(?:\?|$)/);
    if (possessiveMatch) {
        return queryAboutEntity(engine, possessiveMatch[1].trim(), config);
    }
    // ─── FALLBACK: Extract entity names from question and search ───
    return querySmartFallback(engine, question, config);
}
// ─── New: Query entity's specific relations ──────────────────────
async function queryEntityRelations(engine, entityName, relationTypes, config) {
    let entity = engine.findEntityByName(entityName);
    if (!entity) {
        const results = engine.searchEntities(entityName, 1);
        if (results.length === 0) {
            return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
        }
        entity = results[0];
    }
    const outgoing = engine.getRelationsFrom(entity.id);
    const incoming = engine.getRelationsTo(entity.id);
    // Filter by relation types (case-insensitive partial match)
    const matchedOut = outgoing.filter(r => relationTypes.some(rt => r.relation.toUpperCase().includes(rt.toUpperCase())));
    const matchedIn = incoming.filter(r => relationTypes.some(rt => r.relation.toUpperCase().includes(rt.toUpperCase())));
    if (matchedOut.length > 0 || matchedIn.length > 0) {
        const parts = [];
        if (matchedOut.length > 0)
            parts.push(matchedOut.map(r => `${r.relation} → ${r.to_name}`).join(', '));
        if (matchedIn.length > 0)
            parts.push(matchedIn.map(r => `${r.from_name} → ${r.relation}`).join(', '));
        return {
            answer: `${entity.name}: ${parts.join('; ')}`,
            entities: [...matchedOut.map(r => ({ name: r.to_name, type: r.to_type })), ...matchedIn.map(r => ({ name: r.from_name, type: r.from_type }))],
            confidence: 0.85,
        };
    }
    // Fallback: show all relations (the info might be stored differently)
    return queryAboutEntity(engine, entity.name, config);
}
// ─── New: Query entity properties ────────────────────────────────
async function queryEntityProperties(engine, entityName, propertyKeys, config) {
    let entity = engine.findEntityByName(entityName);
    if (!entity) {
        const results = engine.searchEntities(entityName, 1);
        if (results.length === 0) {
            return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
        }
        entity = results[0];
    }
    // Check properties
    const props = entity.properties || {};
    const matchedProps = propertyKeys
        .filter(k => props[k])
        .map(k => `${k}: ${props[k]}`);
    if (matchedProps.length > 0) {
        return {
            answer: `${entity.name}: ${matchedProps.join(', ')}`,
            entities: [{ name: entity.name, type: entity.type }],
            confidence: 0.9,
        };
    }
    // Check relations that might encode role (e.g., LEADS, MANAGES)
    const outgoing = engine.getRelationsFrom(entity.id);
    const roleRelations = outgoing.filter(r => ['LEADS', 'MANAGES', 'HEADS', 'WORKS_AS', 'ROLE_IS'].includes(r.relation.toUpperCase()));
    if (roleRelations.length > 0) {
        return {
            answer: `${entity.name}: ${roleRelations.map(r => `${r.relation} → ${r.to_name}`).join(', ')}`,
            entities: [{ name: entity.name, type: entity.type }],
            confidence: 0.85,
        };
    }
    // Fallback to full entity info
    return queryAboutEntity(engine, entity.name, config);
}
// ─── New: "Who works at [entity]?" ───────────────────────────────
async function queryWhoAtEntity(engine, entityName, config) {
    let entity = engine.findEntityByName(entityName);
    if (!entity) {
        const results = engine.searchEntities(entityName, 1);
        if (results.length === 0) {
            return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
        }
        entity = results[0];
    }
    const incoming = engine.getRelationsTo(entity.id);
    const workers = incoming
        .filter(r => ['WORKS_AT', 'EMPLOYED_BY', 'MEMBER_OF', 'BELONGS_TO', 'WORKS_FOR', 'HIRED_BY'].includes(r.relation.toUpperCase()))
        .map(r => ({ name: r.from_name, type: r.from_type, relation: r.relation }));
    // Also check outgoing (entity EMPLOYS person)
    const outgoing = engine.getRelationsFrom(entity.id);
    const employed = outgoing
        .filter(r => ['EMPLOYS', 'HIRED', 'HAS_MEMBER', 'HAS_EMPLOYEE'].includes(r.relation.toUpperCase()))
        .map(r => ({ name: r.to_name, type: r.to_type, relation: r.relation }));
    const all = [...workers, ...employed];
    if (all.length > 0) {
        return {
            answer: `People at ${entity.name}: ${all.map(p => p.name).join(', ')}`,
            entities: all.map(p => ({ name: p.name, type: p.type })),
            confidence: 0.85,
        };
    }
    // Broader: any person connected to this entity
    const incomingPeople = incoming
        .filter(r => r.from_type?.toLowerCase() === 'person')
        .map(r => ({ name: r.from_name, type: r.from_type }));
    const outgoingPeople = outgoing
        .filter(r => r.to_type?.toLowerCase() === 'person')
        .map(r => ({ name: r.to_name, type: r.to_type }));
    const allConnected = [...incomingPeople, ...outgoingPeople];
    const unique = [...new Map(allConnected.map(r => [r.name, r])).values()];
    if (unique.length > 0) {
        return {
            answer: `People connected to ${entity.name}: ${unique.map(p => p.name).join(', ')}`,
            entities: unique,
            confidence: 0.75,
        };
    }
    return { answer: `No people found at "${entityName}".`, entities: [], confidence: 0.3 };
}
// ─── New: "Who [verb]ed [entity]?" ───────────────────────────────
async function queryWhoDidEntity(engine, verb, entityName, config) {
    let entity = engine.findEntityByName(entityName);
    if (!entity) {
        const results = engine.searchEntities(entityName, 1);
        if (results.length === 0) {
            // Maybe the whole phrase is the entity
            return querySmartFallback(engine, `who ${verb} ${entityName}`, config);
        }
        entity = results[0];
    }
    // Normalize verb to relation: "suggested" → "SUGGEST", "created" → "CREATE"
    const verbRoot = verb.replace(/ed$|s$|es$|ing$/, '').toUpperCase();
    const verbVariants = [verbRoot, `${verbRoot}S`, `${verbRoot}ED`, `${verbRoot}ES`];
    const incoming = engine.getRelationsTo(entity.id);
    const matched = incoming.filter(r => {
        const rel = r.relation.toUpperCase();
        return verbVariants.some(v => rel.includes(v)) || rel.includes(verbRoot);
    });
    if (matched.length > 0) {
        return {
            answer: `${matched.map(r => `${r.from_name} ${r.relation} ${entity.name}`).join(', ')}`,
            entities: matched.map(r => ({ name: r.from_name, type: r.from_type })),
            confidence: 0.85,
        };
    }
    // Fallback: show all incoming
    if (incoming.length > 0) {
        const people = incoming.filter(r => r.from_type?.toLowerCase() === 'person');
        if (people.length > 0) {
            return {
                answer: `People connected to ${entity.name}: ${people.map(r => `${r.from_name} (${r.relation})`).join(', ')}`,
                entities: people.map(r => ({ name: r.from_name, type: r.from_type })),
                confidence: 0.7,
            };
        }
    }
    return queryAboutEntity(engine, entity.name, config);
}
// ─── Smart Fallback: find entity names in the question ───────────
async function querySmartFallback(engine, question, config) {
    const allEntities = engine.listEntities({ limit: 500 });
    if (allEntities.length === 0) {
        return { answer: 'Graph is empty. Ingest some data first.', entities: [], confidence: 0.2 };
    }
    const qLower = question.toLowerCase();
    // Find entities mentioned in the question (longest match first)
    const mentioned = allEntities
        .filter(e => qLower.includes(e.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length);
    if (mentioned.length > 0) {
        return queryAboutEntity(engine, mentioned[0].name, config);
    }
    // Try word-by-word search (skip common words)
    const stopWords = new Set(['what', 'who', 'where', 'when', 'how', 'why', 'does', 'did', 'the', 'are', 'is', 'was', 'were', 'has', 'have', 'had', 'all', 'any', 'some', 'this', 'that', 'which', 'there', 'their', 'about', 'from', 'with', 'for', 'and', 'but', 'not', 'can', 'will', 'would', 'should', 'could', 'been', 'being', 'mentioned', 'used', 'listed']);
    const words = question.replace(/[?!.,;:'"]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
    for (const word of words) {
        const results = engine.searchEntities(word, 3);
        if (results.length > 0) {
            return queryAboutEntity(engine, results[0].name, config);
        }
    }
    return { answer: `No relevant entities found for: "${question}"`, entities: [], confidence: 0.2 };
}
// ─── Core Query Implementations ─────────────────────────────────
async function queryByRelationPattern(engine, relationHint, config) {
    const relationMap = {
        'working on': ['WORKS_ON', 'CONTRIBUTES_TO', 'MAINTAINS'],
        'using': ['USES', 'DEPENDS_ON'],
        'own': ['OWNS', 'CREATED'],
        'managing': ['MANAGES', 'LEADS'],
        'learning': ['LEARNING', 'STUDIES'],
        'holding': ['HOLDS', 'OWNS'],
        'mining': ['MINES'],
        'building': ['BUILDS', 'CREATES'],
    };
    const matchedRelations = Object.entries(relationMap)
        .filter(([phrase]) => relationHint.includes(phrase))
        .flatMap(([, rels]) => rels);
    const selfEntities = engine.searchEntities('self user me', 5)
        .filter(e => e.type.toLowerCase() === 'person');
    const results = [];
    for (const self of selfEntities) {
        const rels = engine.getRelationsFrom(self.id);
        for (const rel of rels) {
            if (matchedRelations.length === 0 || matchedRelations.includes(rel.relation)) {
                results.push({ name: rel.to_name, type: rel.to_type });
            }
        }
    }
    const unique = [...new Map(results.map(r => [r.name, r])).values()];
    return {
        answer: unique.length > 0
            ? `Found ${unique.length} result(s): ${unique.map(r => `${r.name} (${r.type})`).join(', ')}`
            : 'No matching relationships found in the graph.',
        entities: unique,
        confidence: unique.length > 0 ? 0.8 : 0.3,
    };
}
async function queryWhoRelation(engine, relation, entityName, config) {
    const entity = engine.findEntityByName(entityName.trim());
    if (!entity) {
        const results = engine.searchEntities(entityName.trim(), 1);
        if (results.length > 0) {
            return queryWhoRelation(engine, relation, results[0].name, config);
        }
        return { answer: `Entity "${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
    }
    const incoming = engine.getRelationsTo(entity.id);
    const people = incoming
        .filter(r => r.from_type.toLowerCase() === 'person')
        .map(r => ({ name: r.from_name, type: r.from_type }));
    const outgoing = engine.getRelationsFrom(entity.id);
    const outPeople = outgoing
        .filter(r => r.to_type.toLowerCase() === 'person')
        .map(r => ({ name: r.to_name, type: r.to_type }));
    const all = [...people, ...outPeople];
    const unique = [...new Map(all.map(r => [r.name, r])).values()];
    return {
        answer: unique.length > 0
            ? `${unique.map(p => p.name).join(', ')} → ${entityName}`
            : `No people found connected to "${entityName}".`,
        entities: unique,
        confidence: unique.length > 0 ? 0.85 : 0.3,
    };
}
async function queryConnection(engine, fromName, toName, config) {
    const path = engine.findPath(fromName, toName, config.query.maxHops);
    if (!path) {
        return {
            answer: `No connection found between "${fromName}" and "${toName}" within ${config.query.maxHops} hops.`,
            entities: [],
            confidence: 0.5,
        };
    }
    const pathStr = path.path
        .map((node, i) => i < path.relations.length ? `${node} ->[${path.relations[i]}]` : node)
        .join(' ');
    return {
        answer: `Path: ${pathStr}`,
        entities: path.path.map(name => ({ name, type: 'Unknown' })),
        paths: [path],
        confidence: 0.9,
    };
}
async function queryListType(engine, typeName, config) {
    // Normalize: "people" → "person", "languages" → "language", etc.
    const typeNormMap = {
        'people': 'person',
        'persons': 'person',
        'companies': 'company',
        'organizations': 'organization',
        'organisations': 'organization',
        'tools': 'tool',
        'projects': 'project',
        'languages': 'language',
        'programming languages': 'language',
        'databases': 'database',
        'services': 'service',
        'teams': 'team',
        'technologies': 'technology',
    };
    const normalized = typeNormMap[typeName.toLowerCase()] || typeName;
    // Try multiple case variations
    const variations = [
        normalized,
        normalized.charAt(0).toUpperCase() + normalized.slice(1),
        normalized.toUpperCase(),
        normalized.toLowerCase(),
        // Also try without trailing 's'
        normalized.endsWith('s') ? normalized.slice(0, -1) : normalized,
        normalized.endsWith('s') ? (normalized.slice(0, -1).charAt(0).toUpperCase() + normalized.slice(0, -1).slice(1)) : (normalized.charAt(0).toUpperCase() + normalized.slice(1)),
    ];
    for (const v of [...new Set(variations)]) {
        const found = engine.listEntities({ type: v, limit: config.query.maxResults });
        if (found.length > 0) {
            return {
                answer: `Found ${found.length} ${typeName}(s): ${found.map(e => e.name).join(', ')}`,
                entities: found.map(e => ({ name: e.name, type: e.type })),
                confidence: 0.85,
            };
        }
    }
    // Try FTS search as last resort
    const searchResults = engine.searchEntities(typeName, config.query.maxResults);
    if (searchResults.length > 0) {
        return {
            answer: `Found ${searchResults.length} result(s) for "${typeName}": ${searchResults.map(e => `${e.name} (${e.type})`).join(', ')}`,
            entities: searchResults.map(e => ({ name: e.name, type: e.type })),
            confidence: 0.7,
        };
    }
    return {
        answer: `No entities of type "${typeName}" found.`,
        entities: [],
        confidence: 0.3,
    };
}
async function queryAboutEntity(engine, entityName, config) {
    let entity = engine.findEntityByName(entityName);
    if (!entity) {
        const results = engine.searchEntities(entityName, 1);
        if (results.length === 0) {
            return { answer: `"${entityName}" not found in graph.`, entities: [], confidence: 0.2 };
        }
        entity = results[0];
    }
    const outgoing = engine.getRelationsFrom(entity.id);
    const incoming = engine.getRelationsTo(entity.id);
    const lines = [
        `${entity.name} (${entity.type})${entity.mention_count && entity.mention_count > 1 ? ` [mentions: ${entity.mention_count}]` : ''}`,
    ];
    if (Object.keys(entity.properties).length > 0) {
        lines.push(`Properties: ${JSON.stringify(entity.properties)}`);
    }
    if (outgoing.length > 0) {
        lines.push(`Outgoing: ${outgoing.map(r => `${r.relation} → ${r.to_name}`).join(', ')}`);
    }
    if (incoming.length > 0) {
        lines.push(`Incoming: ${incoming.map(r => `${r.from_name} → ${r.relation}`).join(', ')}`);
    }
    return {
        answer: lines.join('\n'),
        entities: [
            { name: entity.name, type: entity.type },
            ...outgoing.map(r => ({ name: r.to_name, type: r.to_type })),
            ...incoming.map(r => ({ name: r.from_name, type: r.from_type })),
        ],
        confidence: 0.9,
    };
}
//# sourceMappingURL=natural-language.js.map