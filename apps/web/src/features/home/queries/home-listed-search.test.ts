import type { EntityData } from '@entity/types/entity';
import { describe, expect, it, vi } from 'vitest';
import { searchListedHomeEntities } from './home-listed-search';

vi.mock('@entity', async () => await import('@entity/types/entity'));

const entity = (
  type: 'document' | 'chat' | 'email',
  id: string,
  name: string
) => ({ type, id, name }) as EntityData;

describe('searchListedHomeEntities', () => {
  it('finds every listed row whose name matches, whatever the search service returned', () => {
    const listed = [
      entity('email', 'e1', 'Hello'),
      entity('document', 'd1', 'Quarterly plan'),
      entity('chat', 'c1', 'tell me hello'),
      entity('document', 'd2', 'Hello Gab'),
      entity('email', 'e2', 'hello from my outlook'),
    ];

    const results = searchListedHomeEntities(listed, [], 'hello');

    expect(results.map((result) => result.id)).toEqual([
      'e1',
      'c1',
      'd2',
      'e2',
    ]);
  });

  it('lists matching Home rows in Home order ahead of other search hits, once each', () => {
    const listed = [
      entity('document', 'd1', 'Deploy checklist'),
      entity('email', 'e1', 'Standup notes'),
      entity('chat', 'c1', 'Prod deploy'),
    ];
    const hits = [
      entity('email', 'e9', 'A message that mentions deploy in its body'),
      entity('chat', 'c1', 'Prod deploy'),
    ];

    const results = searchListedHomeEntities(listed, hits, 'deploy');

    expect(results.map((result) => `${result.type}:${result.id}`)).toEqual([
      'document:d1',
      'chat:c1',
      'email:e9',
    ]);
  });

  it('keeps rows of different types that share an id apart', () => {
    const listed = [entity('document', 'same', 'Roadmap')];
    const hits = [entity('email', 'same', 'Re: roadmap')];

    const results = searchListedHomeEntities(listed, hits, 'roadmap');

    expect(results.map((result) => result.type)).toEqual(['document', 'email']);
  });
});
