import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryGraph } from '../src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('MemoryGraph (Integration)', () => {
  let graph: MemoryGraph;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'amg-int-'));
    graph = new MemoryGraph({ path: join(tempDir, 'test.db') });
  });

  afterEach(() => {
    graph.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Manual Operations (no LLM needed)', () => {
    it('should add entities and relations manually', () => {
      graph.addEntity('Alice', 'Person', { role: 'developer' });
      graph.addEntity('Project X', 'Project');
      graph.addRelation('Alice', 'WORKS_ON', 'Project X');

      const stats = graph.stats();
      expect(stats.entities).toBe(2);
      expect(stats.relationships).toBe(1);
    });

    it('should search entities', () => {
      graph.addEntity('React', 'Framework');
      graph.addEntity('Vue', 'Framework');
      graph.addEntity('PostgreSQL', 'Database');

      const results = graph.search('React');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity.name).toBe('React');
    });

    it('should find entity by name', () => {
      graph.addEntity('Alice', 'Person');
      const found = graph.findEntity('Alice');
      expect(found).not.toBeNull();
      expect(found!.type).toBe('Person');
    });

    it('should find path between entities', () => {
      graph.addEntity('Alice', 'Person');
      graph.addEntity('Project X', 'Project');
      graph.addEntity('Rust', 'Language');

      graph.addRelation('Alice', 'WORKS_ON', 'Project X');
      graph.addRelation('Project X', 'USES', 'Rust');

      const path = graph.findPath('Alice', 'Rust');
      expect(path).not.toBeNull();
      expect(path!.path).toEqual(['Alice', 'Project X', 'Rust']);
    });

    it('should get neighborhood', () => {
      graph.addEntity('Alice', 'Person');
      graph.addEntity('Bob', 'Person');
      graph.addEntity('Project X', 'Project');

      graph.addRelation('Alice', 'WORKS_ON', 'Project X');
      graph.addRelation('Bob', 'WORKS_ON', 'Project X');

      const hood = graph.neighborhood('Project X', 1);
      expect(hood.entities.length).toBe(3);
      expect(hood.relationships.length).toBe(2);
    });

    it('should delete entity', () => {
      graph.addEntity('Temp', 'Thing');
      expect(graph.deleteEntity('Temp')).toBe(true);
      expect(graph.findEntity('Temp')).toBeNull();
    });

    it('should list entities by type', () => {
      graph.addEntity('Alice', 'Person');
      graph.addEntity('Bob', 'Person');
      graph.addEntity('React', 'Tool');

      const people = graph.listEntities({ type: 'Person' });
      expect(people.length).toBe(2);
    });
  });

  describe('Export', () => {
    beforeEach(() => {
      graph.addEntity('Alice', 'Person');
      graph.addEntity('Project X', 'Project');
      graph.addEntity('Rust', 'Language');
      graph.addRelation('Alice', 'WORKS_ON', 'Project X');
      graph.addRelation('Project X', 'USES', 'Rust');
    });

    it('should export as JSON', () => {
      const json = graph.export('json');
      const parsed = JSON.parse(json);
      expect(parsed.nodes.length).toBe(3);
      expect(parsed.edges.length).toBe(2);
      expect(parsed.stats.entities).toBe(3);
    });

    it('should export as Mermaid', () => {
      const mermaid = graph.export('mermaid');
      expect(mermaid).toContain('graph LR');
      expect(mermaid).toContain('WORKS_ON');
      expect(mermaid).toContain('USES');
    });

    it('should export as DOT', () => {
      const dot = graph.export('dot');
      expect(dot).toContain('digraph MemoryGraph');
      expect(dot).toContain('WORKS_ON');
    });

    it('should export as CSV', () => {
      const csv = graph.export('csv');
      const lines = csv.split('\n');
      expect(lines[0]).toContain('from_name');
      expect(lines.length).toBe(3); // header + 2 relationships
    });
  });

  describe('Deduplication', () => {
    it('should find duplicate entities', () => {
      graph.addEntity('JavaScript', 'Language');
      graph.addEntity('JavaScriptLang', 'Language');
      graph.addEntity('Python', 'Language');

      const dupes = graph.deduplicate({ threshold: 0.8 });
      expect(dupes.length).toBe(1);
      expect(dupes[0].similarity).toBeGreaterThan(0.8);
    });

    it('should not flag different entities as duplicates', () => {
      graph.addEntity('React', 'Framework');
      graph.addEntity('Vue', 'Framework');

      const dupes = graph.deduplicate();
      expect(dupes.length).toBe(0);
    });

    it('should auto-merge when requested', () => {
      graph.addEntity('JavaScript', 'Language');
      graph.addEntity('JavaScriptLang', 'Language');

      graph.deduplicate({ autoMerge: true });

      const stats = graph.stats();
      expect(stats.entities).toBe(1);
    });
  });

  describe('Stats', () => {
    it('should return comprehensive stats', () => {
      graph.addEntity('Alice', 'Person');
      graph.addEntity('Project X', 'Project');
      graph.addRelation('Alice', 'WORKS_ON', 'Project X');

      const stats = graph.stats();
      expect(stats.entities).toBe(2);
      expect(stats.relationships).toBe(1);
      expect(stats.entityTypes).toContain('Person');
      expect(stats.entityTypes).toContain('Project');
      expect(stats.relationTypes).toContain('WORKS_ON');
      expect(stats.oldestEntry).not.toBeNull();
      expect(stats.newestEntry).not.toBeNull();
    });
  });
});
