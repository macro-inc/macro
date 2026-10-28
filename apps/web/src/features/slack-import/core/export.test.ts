// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  corporateEntries,
  enterpriseEntries,
  standardEntries,
  USERS,
} from '../tests/zip-fixtures';
import {
  type ArchiveDiscovery,
  parseDay,
  resolveExport,
  validateArchivePath,
} from './export';

function resolve(entries: Record<string, unknown>): ArchiveDiscovery {
  return resolveExport(
    new Map(Object.entries(entries).filter(([path]) => !path.includes('/'))),
    Object.keys(entries).filter((path) => path.includes('/'))
  );
}

describe('Slack export metadata', () => {
  it('preserves complete metadata and explicitly unknown counts/source', () => {
    const discovery = resolve(standardEntries());
    expect(discovery.source).toEqual({ kind: 'unknown' });
    expect(discovery.conversations).toEqual([
      {
        slackChannelId: 'C100',
        kind: 'public_channel',
        name: 'general',
        folder: 'general',
        memberIds: ['U100', 'U200'],
        creatorId: null,
        createdAt: '1700000000.000000',
        archived: false,
        messageCount: null,
      },
    ]);
    expect(discovery.users[0].profile?.email).toBe('Alice+Slack@Example.Test');
  });

  it('uses file kind, not ID prefix; missing creation dates remain null', () => {
    expect(
      resolve(corporateEntries()).conversations.map((item) => [
        item.kind,
        item.createdAt,
      ])
    ).toEqual([
      ['private_channel', null],
      ['direct_message', null],
      ['group_direct_message', null],
    ]);
  });

  it('accepts Enterprise users without mistaking user teams for archive identity', () => {
    const discovery = resolve(enterpriseEntries());
    expect(discovery.users[0].id).toBe('W100');
    expect(discovery.source).toEqual({ kind: 'unknown' });
    expect(
      resolve({ ...enterpriseEntries(), 'team.json': { id: 'T100' } }).source
    ).toEqual({ kind: 'known', sourceId: 'T100' });
  });

  it('merges identical users but rejects conflicting records across both filenames', () => {
    expect(
      resolve({ ...standardEntries(), 'org_users.json': USERS }).users
    ).toHaveLength(2);
    expect(() =>
      resolve({
        ...standardEntries(),
        'org_users.json': [{ id: 'U100', name: 'different' }],
      })
    ).toThrow('conflicting');
  });

  it('resolves renamed channels by ID or previous-name metadata, never by guessing', () => {
    const roots = new Map<string, unknown>([
      ['users.json', USERS],
      [
        'channels.json',
        [
          {
            id: 'C100',
            name: 'renamed',
            previous_names: ['general'],
            members: [],
          },
        ],
      ],
    ]);
    expect(
      resolveExport(roots, ['general/2020-01-01.json']).conversations[0].folder
    ).toBe('general');
    expect(
      resolveExport(roots, ['C100/2020-01-01.json']).conversations[0].folder
    ).toBe('C100');
    expect(() => resolveExport(roots, ['unknown/2020-01-01.json'])).toThrow(
      'cannot be resolved'
    );
    expect(() =>
      resolveExport(roots, ['general/2020-01-01.json', 'C100/2020-01-01.json'])
    ).toThrow('matches');
  });

  it('rejects shared folder names and duplicate conversation IDs', () => {
    const entries = standardEntries();
    entries['groups.json'] = [{ id: 'G100', name: 'general', members: [] }];
    expect(() => resolve(entries)).toThrow('matches');
    entries['groups.json'] = [{ id: 'C100', name: 'other', members: [] }];
    expect(() => resolve(entries)).toThrow('conflicting');
  });

  it('requires users, conversation metadata and full member lists', () => {
    expect(() => resolve({ 'channels.json': [] })).toThrow('requires');
    expect(() => resolve({ 'users.json': [] })).toThrow('requires');
    expect(() =>
      resolve({
        'users.json': [],
        'channels.json': [{ id: 'C100', name: 'general' }],
      })
    ).toThrow('invalid');
  });

  it.each(['1700000000.000001', '1700000000.000002'])(
    'retains exact creation timestamp %s',
    (created) => {
      const entries = {
        'users.json': [],
        'channels.json': [{ id: 'C100', members: [], created }],
      };
      expect(resolve(entries).conversations[0].createdAt).toBe(created);
    }
  );

  it.each(['1.0000001', '253402300800', -1, 1.5])(
    'rejects invalid creation time %s',
    (created) => {
      expect(() =>
        resolve({
          'users.json': [],
          'channels.json': [{ id: 'C100', members: [], created }],
        })
      ).toThrow('invalid');
    }
  );
});

describe('paths and day JSON', () => {
  it.each([
    '../users.json',
    '/users.json',
    'a/../b',
    'a\\b',
    'a//b',
    'a/%2e%2e',
    'C:/users.json',
    'FC:F100:../users.json',
    'FC:F100:notes/../users.json',
    'FC:F100:notes/%2e%2e/users.json',
    'FC:F100:notes\\users.json',
    'FC:F100:notes:stream/2020-01-01.json',
    'FC:not-a-file:notes/2020-01-01.json',
    'a/\u0000b',
    'a/'.repeat(600),
  ])('rejects unsafe path %j', (path) => {
    expect(() => validateArchivePath(path)).toThrow('unsafe');
  });
  it('allows Unicode folders, spaces and directory entries', () => {
    expect(() =>
      validateArchivePath('project café/2020-01-01.json')
    ).not.toThrow();
    expect(() => validateArchivePath('project café/')).not.toThrow();
    expect(() => validateArchivePath('FC:F100:Project café/')).not.toThrow();
    expect(() =>
      validateArchivePath('FC:F100:Project café/2020-01-01.json')
    ).not.toThrow();
  });
  it.each(['{', '{}', '[null]', '[1]', '[[]]'])(
    'rejects malformed day JSON %s',
    (text) => {
      expect(() => parseDay(new TextEncoder().encode(text))).toThrow(
        'valid JSON array'
      );
    }
  );
  it('rejects invalid UTF-8 instead of silently replacing content', () => {
    expect(() => parseDay(new Uint8Array([0xff]))).toThrow('valid JSON');
  });
});
