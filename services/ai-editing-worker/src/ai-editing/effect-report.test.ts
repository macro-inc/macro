import { describe, expect, it } from 'vitest';
import { describeEffect, diffNodes, snapshotNodes } from './effect-report';

const doc = (...lines: string[]) => ['<doc>', ...lines, '</doc>'].join('\n');

describe('snapshotNodes', () => {
  it('indexes nodes by durable id', () => {
    const snap = snapshotNodes(
      doc('  <p id="p1">', '    <t id="t1">hi</t>', '  </p>')
    );
    expect([...snap.keys()].sort()).toEqual(['p1', 't1']);
  });

  it("includes a node's descendants in its body", () => {
    const snap = snapshotNodes(
      doc('  <p id="p1">', '    <t id="t1">hi</t>', '  </p>')
    );
    expect(snap.get('p1')).toContain('hi');
  });

  it('ignores nodes without ids', () => {
    expect([...snapshotNodes(doc('  <br/>')).keys()]).toEqual([]);
  });
});

describe('diffNodes', () => {
  const base = snapshotNodes(
    doc('  <p id="p1">', '    <t id="t1">before</t>', '  </p>')
  );

  it('reports no change for an identical document', () => {
    const effect = diffNodes(base, snapshotNodes(
      doc('  <p id="p1">', '    <t id="t1">before</t>', '  </p>')
    ));
    expect(effect.changed).toBe(false);
  });

  it('reports a modified node', () => {
    const effect = diffNodes(base, snapshotNodes(
      doc('  <p id="p1">', '    <t id="t1">after</t>', '  </p>')
    ));
    expect(effect.changed).toBe(true);
    expect(effect.modifiedIds).toContain('t1');
  });

  it('reports added and removed nodes', () => {
    const effect = diffNodes(base, snapshotNodes(
      doc('  <p id="p2">', '    <t id="t2">new</t>', '  </p>')
    ));
    expect(effect.addedIds.sort()).toEqual(['p2', 't2']);
    expect(effect.removedIds.sort()).toEqual(['p1', 't1']);
  });

  it('marks a parent modified when a descendant changes', () => {
    const effect = diffNodes(base, snapshotNodes(
      doc('  <p id="p1">', '    <t id="t1">after</t>', '  </p>')
    ));
    expect(effect.modifiedIds).toContain('p1');
  });
});

describe('describeEffect', () => {
  it('states NO CHANGE as an observable fact, without instructing the model', () => {
    const out = describeEffect('ok', {
      changed: false,
      addedIds: [],
      removedIds: [],
      modifiedIds: [],
    });
    expect(out).toContain('NO CHANGE');
    expect(out).toContain('byte-identical');
    // The exhortation was measured ineffective (8/9 NO CHANGE replies retried
    // anyway); the raised errors carry the behaviour instead.
    expect(out).not.toMatch(/Do NOT/i);
  });

  it('lists what changed so the coder can confirm its target', () => {
    const out = describeEffect('ok', {
      changed: true,
      addedIds: ['n2'],
      removedIds: ['n3'],
      modifiedIds: ['n1'],
    });
    expect(out).toContain('CHANGED');
    expect(out).toContain('modified n1');
    expect(out).toContain('added n2');
    expect(out).toContain('removed n3');
  });

  it('keeps a partial failure visible alongside the effect', () => {
    const out = describeEffect('error: setText: no node "zz"', {
      changed: true,
      addedIds: [],
      removedIds: [],
      modifiedIds: ['n1'],
    });
    expect(out).toContain('error: setText');
    expect(out).toContain('modified n1');
  });

  it('caps the id list rather than dumping a whole document', () => {
    const many = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const out = describeEffect('ok', {
      changed: true,
      addedIds: [],
      removedIds: [],
      modifiedIds: many,
    });
    expect(out).toContain('+22 more');
  });

  /**
   * Regression for the corpus's worst observed thrash (trace dd3c373b): three
   * check-list items were ALREADY unchecked, so six consecutive `uncheck` /
   * `setChecked` calls each returned bare `ok` and the coder kept guessing.
   * The point of this test is that such a call is now self-evidently futile.
   */
  it('makes an already-satisfied edit self-evidently futile', () => {
    const before = snapshotNodes(doc('  <li id="a">', '    <t id="t">x</t>', '  </li>'));
    const after = snapshotNodes(doc('  <li id="a">', '    <t id="t">x</t>', '  </li>'));
    const out = describeEffect('ok', diffNodes(before, after));
    expect(out).toContain('NO CHANGE');
    expect(out).not.toMatch(/^ok$/);
  });
});
