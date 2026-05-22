import { readFileSync, existsSync } from 'node:fs';
import { GraphEngine } from '../graph/engine.js';
import { extractFromText } from '../extract/extractor.js';
import type { Config } from '../config/schema.js';

/**
 * Import entities and relationships from a MEMORY.md file.
 * Splits the file into sections and extracts from each.
 */
export async function importFromMemoryMd(
  filePath: string,
  engine: GraphEngine,
  config: Config
): Promise<{ entities: number; relationships: number }> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');

  // Split into meaningful sections (by headers or double newlines)
  const sections = splitIntoSections(content);

  let totalEntities = 0;
  let totalRelationships = 0;

  for (const section of sections) {
    if (section.trim().length < 20) continue; // Skip tiny sections

    try {
      const result = await extractFromText(section, config);

      // Store entities
      for (const entity of result.entities) {
        engine.addEntity(entity.name, entity.type, entity.properties ?? {}, {
          source: filePath,
          confidence: entity.confidence,
        });
        totalEntities++;
      }

      // Store relationships
      for (const rel of result.relationships) {
        engine.addRelation(rel.from, rel.relation, rel.to, {
          source: filePath,
          confidence: rel.confidence,
          fromType: rel.fromType,
          toType: rel.toType,
        });
        totalRelationships++;
      }
    } catch (err) {
      console.warn(`[agent-memory-graph] Failed to extract from section: ${err}`);
    }
  }

  return { entities: totalEntities, relationships: totalRelationships };
}

/**
 * Import from a directory of markdown files.
 */
export async function importFromDirectory(
  dirPath: string,
  engine: GraphEngine,
  config: Config
): Promise<{ entities: number; relationships: number; files: number }> {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  let totalEntities = 0;
  let totalRelationships = 0;
  let fileCount = 0;

  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && (entry.endsWith('.md') || entry.endsWith('.txt'))) {
      const result = await importFromMemoryMd(fullPath, engine, config);
      totalEntities += result.entities;
      totalRelationships += result.relationships;
      fileCount++;
    }
  }

  return { entities: totalEntities, relationships: totalRelationships, files: fileCount };
}

// ─── Helpers ─────────────────────────────────────────────────────

function splitIntoSections(content: string): string[] {
  // Split by markdown headers or double newlines
  const sections = content.split(/(?=^#{1,3}\s)/m);

  // If no headers found, split by double newlines
  if (sections.length <= 1) {
    return content.split(/\n\n+/).filter(s => s.trim().length > 0);
  }

  return sections.filter(s => s.trim().length > 0);
}
