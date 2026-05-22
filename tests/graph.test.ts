import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphEngine } from '../src/graph/engine.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GraphEngine', () => {
  let engine: GraphEngine;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'amg-test-'));
    engine = new GraphEngine(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    engine.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Entity CRUD', () => {
    it('should add and retrieve an entity', () => {
      const entity = engine.addEntity('Alice', 'Person', { role: 'developer' });
      expect(entity.id).toMatch(/^e-/);
      expect(entity.name).toBe('Alice');
      expect(entity.type).toBe('Person');
      expect(entity.properties).toEqual({ role: 'developer' });
      expect(entity.confidence).toBe(1.0);

      const retrieved = engine.getEntity(entity.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Alice');
    });

    it('should find entity by name (case-insensitive)', () => {
      engine.addEntity('Project Atlas', 'Project');
      const found = engine.findEntityByName('project atlas');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Project Atlas');
    });

    it('should find entity by name and type', () => {
      engine.addEntity('Atlas', 'Project');
      engine.addEntity('Atlas', 'Person');

      const project = engine.findEntityByName('Atlas', 'Project');
      expect(project).not.toBeNull();
      expect(project!.type).toBe('Project');
    });

    it('should update existing entity on duplicate add', () => {
      engine.addEntity('Alice', 'Person', { role: 'dev' });
      const updated = engine.addEntity('Alice', 'Person', { role: 'lead', team: 'backend' });
      expect(updated.properties).toEqual({ role: 'lead', team: 'backend' });

      const all = engine.listEntities();
      expect(all.length).toBe(1);
    });

    it('should update entity properties', () => {
      const entity = engine.addEntity('Bob', 'Person');
      const updated = engine.updateEntity(entity.id, { properties: { skill: 'React' } });
      expect(updated.properties).toEqual({ skill: 'React' });
    });

    it('should delete entity', () => {
      const entity = engine.addEntity('Temp', 'Thing');
      expect(engine.deleteEntity(entity.id)).toBe(true);
      expect(engine.getEntity(entity.id)).toBeNull();
    });

    it('should list entities with type filter', () => {
      engine.addEntity('Alice', 'Person');
      engine.addEntity('Bob', 'Person');
      engine.addEntity('Project X', 'Project');

      const people = engine.listEntities({ type: 'Person' });
      expect(people.length).toBe(2);

      const projects = engine.listEntities({ type: 'Project' });
      expect(projects.length).toBe(1);
    });

    it('should respect limit and offset', () => {
      for (let i = 0; i < 20; i++) {
        engine.addEntity(`Entity ${i}`, 'Thing');
      }

      const page1 = engine.listEntities({ limit: 5, offset: 0 });
      expect(page1.length).toBe(5);

      const page2 = engine.listEntities({ limit: 5, offset: 5 });
      expect(page2.length).toBe(5);
      expect(page2[0].name).not.toBe(page1[0].name);
    });
  });

  describe('Relationship CRUD', () => {
    it('should add a relationship between entities', () => {
      engine.addEntity('Alice', 'Person');
      engine.addEntity('Project X', 'Project');

      const rel = engine.addRelation('Alice', 'WORKS_ON', 'Project X');
      expect(rel.id).toMatch(/^r-/);
      expect(rel.relation).toBe('WORKS_ON');
    });

    it('should auto-create entities if they do not exist', () => {
      const rel = engine.addRelation('NewPerson', 'USES', 'NewTool', {
        fromType: 'Person',
        toType: 'Tool',
      });

      expect(rel.relation).toBe('USES');

      const person = engine.findEntityByName('NewPerson');
      expect(person).not.toBeNull();
      expect(person!.type).toBe('Person');

      const tool = engine.findEntityByName('NewTool');
      expect(tool).not.toBeNull();
      expect(tool!.type).toBe('Tool');
    });

    it('should not duplicate relationships', () => {
      engine.addEntity('A', 'Thing');
      engine.addEntity('B', 'Thing');

      engine.addRelation('A', 'LINKS_TO', 'B');
      engine.addRelation('A', 'LINKS_TO', 'B');

      const rels = engine.getRelationsFrom(engine.findEntityByName('A')!.id);
      expect(rels.length).toBe(1);
    });

    it('should get outgoing relations', () => {
      engine.addEntity('Alice', 'Person');
      engine.addEntity('Project X', 'Project');
      engine.addEntity('Rust', 'Language');

      engine.addRelation('Alice', 'WORKS_ON', 'Project X');
      engine.addRelation('Alice', 'KNOWS', 'Rust');

      const alice = engine.findEntityByName('Alice')!;
      const rels = engine.getRelationsFrom(alice.id);
      expect(rels.length).toBe(2);
      expect(rels.map(r => r.relation).sort()).toEqual(['KNOWS', 'WORKS_ON']);
    });

    it('should get incoming relations', () => {
      engine.addEntity('Alice', 'Person');
      engine.addEntity('Bob', 'Person');
      engine.addEntity('Project X', 'Project');

      engine.addRelation('Alice', 'WORKS_ON', 'Project X');
      engine.addRelation('Bob', 'WORKS_ON', 'Project X');

      const project = engine.findEntityByName('Project X')!;
      const rels = engine.getRelationsTo(project.id);
      expect(rels.length).toBe(2);
    });
  });

  describe('Search', () => {
    it('should search entities by name', () => {
      engine.addEntity('Alice Johnson', 'Person');
      engine.addEntity('Alice Cooper', 'Person');
      engine.addEntity('Bob Smith', 'Person');

      const results = engine.searchEntities('Alice');
      expect(results.length).toBe(2);
    });

    it('should search entities by type', () => {
      engine.addEntity('React', 'Framework');
      engine.addEntity('Vue', 'Framework');
      engine.addEntity('Alice', 'Person');

      const results = engine.searchEntities('Framework');
      expect(results.length).toBe(2);
    });
  });

  describe('Graph Traversal', () => {
    beforeEach(() => {
      // Build a small graph:
      // Alice -[WORKS_ON]-> Project X -[USES]-> Rust -[COMPILED_TO]-> WASM
      engine.addEntity('Alice', 'Person');
      engine.addEntity('Project X', 'Project');
      engine.addEntity('Rust', 'Language');
      engine.addEntity('WASM', 'Target');

      engine.addRelation('Alice', 'WORKS_ON', 'Project X');
      engine.addRelation('Project X', 'USES', 'Rust');
      engine.addRelation('Rust', 'COMPILED_TO', 'WASM');
    });

    it('should find direct path', () => {
      const path = engine.findPath('Alice', 'Project X');
      expect(path).not.toBeNull();
      expect(path!.path).toEqual(['Alice', 'Project X']);
      expect(path!.relations.length).toBe(1);
    });

    it('should find multi-hop path', () => {
      const path = engine.findPath('Alice', 'WASM');
      expect(path).not.toBeNull();
      expect(path!.path).toEqual(['Alice', 'Project X', 'Rust', 'WASM']);
      expect(path!.relations.length).toBe(3);
    });

    it('should return null when no path exists', () => {
      engine.addEntity('Isolated', 'Thing');
      const path = engine.findPath('Alice', 'Isolated');
      expect(path).toBeNull();
    });

    it('should respect maxHops', () => {
      const path = engine.findPath('Alice', 'WASM', 1);
      expect(path).toBeNull(); // Needs 3 hops, limited to 1
    });

    it('should get neighborhood', () => {
      const hood = engine.getNeighborhood('Project X', 1);
      expect(hood.entities.length).toBe(3); // Project X, Alice, Rust
      expect(hood.relationships.length).toBe(2);
    });
  });

  describe('Stats', () => {
    it('should return correct stats', () => {
      engine.addEntity('Alice', 'Person');
      engine.addEntity('Project X', 'Project');
      engine.addRelation('Alice', 'WORKS_ON', 'Project X');

      const stats = engine.stats();
      expect(stats.entities).toBe(2);
      expect(stats.relationships).toBe(1);
      expect(stats.entityTypes).toContain('Person');
      expect(stats.entityTypes).toContain('Project');
      expect(stats.relationTypes).toContain('WORKS_ON');
    });

    it('should return empty stats for new graph', () => {
      const stats = engine.stats();
      expect(stats.entities).toBe(0);
      expect(stats.relationships).toBe(0);
      expect(stats.entityTypes).toEqual([]);
    });
  });

  describe('Memory Log', () => {
    it('should log extractions', () => {
      engine.logExtraction(
        'Alice works on Project X',
        [{ name: 'Alice', type: 'Person' }],
        [{ from: 'Alice', relation: 'WORKS_ON', to: 'Project X' }],
        'session-123'
      );

      // Verify log exists (query directly)
      // The log is write-only for audit; no public read API yet
      // Just ensure it doesn't throw
    });
  });
});
