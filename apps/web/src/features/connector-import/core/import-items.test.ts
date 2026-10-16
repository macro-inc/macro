import { describe, expect, it } from 'vitest';
import { importEntity, importRunState } from '../tests/fake-context';
import { importItems, needsDiscovery, toImportItem } from './import-items';

describe('import items', () => {
  it('labels Linear issues by identifier and status', () => {
    expect(
      toImportItem(
        importEntity({
          id: 'a',
          source: 'linear',
          metadata: { identifier: 'ENG-1', title: 'Fix it', status: 'Todo' },
        })
      )
    ).toMatchObject({ title: 'Fix it', detail: 'ENG-1 · Todo' });
  });

  it('labels Notion pages by summary and links imported entities', () => {
    expect(
      toImportItem(
        importEntity({
          id: 'b',
          source: 'notion',
          status: 'imported',
          metadata: { title: 'Plan', summary: 'Q4 goals' },
          entity_id: 'doc-1',
          entity_type: 'md',
        })
      )
    ).toMatchObject({
      title: 'Plan',
      detail: 'Q4 goals',
      entity: { id: 'doc-1', type: 'md' },
    });
  });

  it('labels Slack channels with a hash, purpose, and member count', () => {
    expect(
      toImportItem(
        importEntity({
          id: 'c',
          source: 'slack',
          metadata: { name: 'eng', purpose: 'Builds', member_count: 4 },
        })
      )
    ).toMatchObject({ title: '#eng', detail: 'Builds · 4 members' });
  });

  it('keeps one source, drops discarded rows, and lists staged first', () => {
    const items = importItems(
      {
        runs: [],
        entities: [
          importEntity({ id: 'done', source: 'notion', status: 'imported' }),
          importEntity({ id: 'gone', source: 'notion', status: 'discarded' }),
          importEntity({ id: 'other', source: 'linear' }),
          importEntity({ id: 'new', source: 'notion' }),
        ],
      },
      'notion'
    );
    expect(items.map((item) => item.id)).toEqual(['new', 'done']);
  });

  it('discovers only when nothing is staged or running', () => {
    const staged = [{ id: 'a', title: 'A', status: 'staged' as const }];
    expect(needsDiscovery(undefined, [])).toBe(true);
    expect(needsDiscovery(undefined, staged)).toBe(false);
    expect(
      needsDiscovery(
        importRunState({ source: 'notion', status: 'running' }),
        []
      )
    ).toBe(false);
    expect(
      needsDiscovery(importRunState({ source: 'notion', status: 'failed' }), [])
    ).toBe(true);
  });
});
