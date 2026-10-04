import { describe, expect, it } from 'vitest';
import type { EntityData } from '../types/entity';
import { isSharedWithViewer } from './shared';

const VIEWER = 'macro|me@example.com';
const PETER = 'macro|peter@example.com';
const ENGINEERING = '01234567-89ab-cdef-0123-456789abcdef';

function row(
  type: EntityData['type'],
  fields: { ownerId?: string; storedForId?: string } = {}
): EntityData {
  return {
    id: `${type}-1`,
    name: type,
    type,
    ownerId: PETER,
    ...fields,
  } as EntityData;
}

describe('isSharedWithViewer', () => {
  it.each([
    ['agent_session', true],
    ['automation', true],
    ['calendar_event', true],
    ['chat', true],
    ['database', true],
    ['document', true],
    ['email', true],
    ['initiative', true],
    ['project', true],
    ['call', false],
    ['channel', false],
    ['channel_message', false],
    ['channel_thread', false],
    ['crm_company', false],
    ['crm_contact', false],
    ['reminder', false],
  ] as const)(
    '%s owned by another user reads as shared: %s',
    (type, shared) => {
      expect(isSharedWithViewer(row(type), VIEWER)).toBe(shared);
    }
  );

  it('reads a foreign row by who it is stored for', () => {
    expect(
      isSharedWithViewer(row('foreign', { storedForId: VIEWER }), VIEWER)
    ).toBe(false);
    expect(
      isSharedWithViewer(row('foreign', { storedForId: ENGINEERING }), VIEWER)
    ).toBe(true);
  });

  it.each([
    { owner: 'another user', ownerId: PETER, shared: true },
    { owner: 'the viewer', ownerId: VIEWER, shared: false },
    {
      owner: 'a bot',
      ownerId: 'bot|5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f',
      shared: true,
    },
    { owner: 'a team', ownerId: ENGINEERING, shared: true },
    { owner: 'nobody', ownerId: '', shared: false },
  ])(
    'a document owned by $owner reads as shared: $shared',
    ({ ownerId, shared }) => {
      expect(isSharedWithViewer(row('document', { ownerId }), VIEWER)).toBe(
        shared
      );
    }
  );
});
