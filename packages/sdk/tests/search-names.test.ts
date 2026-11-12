import { afterEach, expect, test } from 'bun:test';
import { Channel } from '../src/entities/channels/channel';
import { Project } from '../src/entities/projects/project';
import { PropertyOption } from '../src/entities/properties/property-option';
import { User } from '../src/entities/users/user';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'test-token',
    hosts: {
      search: 'https://search.test',
      properties: 'https://properties.test',
      storage: 'https://storage.test',
    },
  });

function serve(handler: (request: Request) => Response | Promise<Response>) {
  globalThis.fetch = (async (input) =>
    handler(
      input instanceof Request ? input : new Request(input),
    )) as typeof fetch;
}

test('looks every name up in one call and returns a handle per match', async () => {
  const paths: string[] = [];
  let body: unknown;
  serve(async (request) => {
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.pathname === '/search/names') {
      body = await request.json();
      return Response.json({
        results: [
          {
            name: '#bug-reports',
            matches: [
              {
                name: 'bug-reports',
                exact: true,
                item: { kind: 'channel', id: 'channel-1' },
              },
              {
                name: 'bug-reports-archive',
                exact: false,
                item: { kind: 'channel', id: 'channel-2' },
              },
            ],
          },
          {
            name: 'Q4 Launch',
            matches: [
              {
                name: 'Q4 Launch',
                exact: true,
                item: { kind: 'project', id: 'folder-1' },
              },
            ],
          },
          {
            name: 'Riley',
            matches: [
              {
                name: 'Riley Chen',
                exact: true,
                item: { kind: 'person', id: 'macro|riley@example.com' },
              },
            ],
          },
        ],
        unavailable: ['database'],
      });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  });

  const lookup = await macro().search.names(
    ['#bug-reports', 'Q4 Launch', { name: 'Riley', kinds: ['person'] }],
    { kinds: ['channel', 'project'] },
  );

  expect(paths).toEqual(['/search/names']);
  expect(body).toEqual({
    names: [
      { name: '#bug-reports', kinds: ['channel', 'project'] },
      { name: 'Q4 Launch', kinds: ['channel', 'project'] },
      { name: 'Riley', kinds: ['person'] },
    ],
  });
  const [channel, folder, person] = lookup.results;
  expect(channel?.matches.map((m) => [m.type, m.name, m.exact])).toEqual([
    ['channel', 'bug-reports', true],
    ['channel', 'bug-reports-archive', false],
  ]);
  expect(channel?.matches[0]?.entity).toBeInstanceOf(Channel);
  expect(channel?.matches[0]?.entity.id).toBe('channel-1');
  expect(folder?.matches[0]?.entity).toBeInstanceOf(Project);
  expect(person?.matches[0]?.entity).toBeInstanceOf(User);
  expect(lookup.unavailable).toEqual(['database']);
});

test('reads each matched tag set once and drops matches whose record is gone', async () => {
  const paths: string[] = [];
  serve((request) => {
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.pathname === '/search/names')
      return Response.json({
        results: [
          {
            name: 'Urgent',
            matches: [
              {
                name: 'Urgent',
                exact: true,
                item: { kind: 'tag', id: 'option-1', definitionId: 'def-1' },
              },
              {
                name: 'Urgent later',
                exact: false,
                item: { kind: 'tag', id: 'option-gone', definitionId: 'def-1' },
              },
              {
                name: 'Urgent',
                exact: true,
                item: { kind: 'channel_label', id: 'label-1' },
              },
            ],
          },
        ],
        unavailable: [],
      });
    if (url.pathname === '/properties/definitions/def-1/options')
      return Response.json([
        {
          id: 'option-1',
          property_definition_id: 'def-1',
          value: { type: 'string', value: 'Urgent' },
          color: null,
          display_order: 0,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
      ]);
    if (url.pathname === '/channel-labels')
      return Response.json({
        labels: [{ id: 'label-1', name: 'Urgent', channel_ids: [] }],
      });
    throw new Error(`unexpected request ${url.pathname}`);
  });

  const lookup = await macro().search.names(['Urgent']);

  expect(paths.sort()).toEqual([
    '/channel-labels',
    '/properties/definitions/def-1/options',
    '/search/names',
  ]);
  const matches = lookup.results[0]?.matches ?? [];
  expect(matches.map((m) => m.type)).toEqual(['tag', 'channel_label']);
  expect(matches[0]?.entity).toBeInstanceOf(PropertyOption);
  expect(matches[1]?.entity).toMatchObject({ id: 'label-1', name: 'Urgent' });
});

test('refuses a bad call before sending it', async () => {
  serve(() => {
    throw new Error('no request expected');
  });
  const search = macro().search;

  await expect(search.names([])).rejects.toThrow('at least one name');
  await expect(
    search.names(Array.from({ length: 11 }, (_, n) => `name ${n}`)),
  ).rejects.toThrow('At most 10 names');
  await expect(search.names([' '])).rejects.toThrow('must not be empty');
  await expect(
    // @ts-expect-error a JavaScript caller's typo
    search.names([{ name: 'ops', kinds: ['folder'] }]),
  ).rejects.toThrow('Invalid name kinds');
});
