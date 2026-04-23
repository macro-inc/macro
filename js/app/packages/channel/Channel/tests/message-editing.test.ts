import { describe, expect, it, vi } from 'vitest';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import type { InputAttachmentData, InputSnapshot } from '../../Input/types';

vi.mock('@core/store/cacheChannelInput', () => ({
  STATIC_IMAGE: 'static/image',
  STATIC_VIDEO: 'static/video',
  isStaticAttachmentType: (v: string) =>
    v === 'static/image' || v === 'static/video',
}));

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => undefined,
}));

import {
  getAttachmentIdsToDelete,
  getAttachmentsToAdd,
} from '../message-editing';

function attachment(
  overrides: Partial<ApiMessageAttachment> & { entity_id: string }
): ApiMessageAttachment {
  return {
    id: `att-${overrides.entity_id}`,
    entity_type: 'document',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function inputAttachment(
  overrides: Partial<InputAttachmentData> & { id: string }
): InputAttachmentData {
  return {
    name: overrides.id,
    kind: 'document',
    ...overrides,
  };
}

function snapshot(attachments: InputAttachmentData[]): InputSnapshot {
  return { value: '', mentions: [], attachments };
}

describe('getAttachmentIdsToDelete', () => {
  it('returns empty when no attachments removed', () => {
    const current = [attachment({ entity_id: 'a' })];
    const next = snapshot([inputAttachment({ id: 'a' })]);
    expect(
      getAttachmentIdsToDelete({
        currentAttachments: current,
        nextSnapshot: next,
      })
    ).toEqual([]);
  });

  it('returns ids of removed attachments', () => {
    const current = [
      attachment({ entity_id: 'a' }),
      attachment({ entity_id: 'b' }),
    ];
    const next = snapshot([inputAttachment({ id: 'a' })]);
    expect(
      getAttachmentIdsToDelete({
        currentAttachments: current,
        nextSnapshot: next,
      })
    ).toEqual(['att-b']);
  });

  it('returns all ids when all attachments removed', () => {
    const current = [attachment({ entity_id: 'a' })];
    const next = snapshot([]);
    expect(
      getAttachmentIdsToDelete({
        currentAttachments: current,
        nextSnapshot: next,
      })
    ).toEqual(['att-a']);
  });
});

describe('getAttachmentsToAdd', () => {
  it('returns empty when no new attachments', () => {
    const current = [attachment({ entity_id: 'a' })];
    const next = snapshot([inputAttachment({ id: 'a' })]);
    expect(
      getAttachmentsToAdd({ currentAttachments: current, nextSnapshot: next })
    ).toEqual([]);
  });

  it('returns new attachments not in current set', () => {
    const current = [attachment({ entity_id: 'a' })];
    const next = snapshot([
      inputAttachment({ id: 'a' }),
      inputAttachment({ id: 'b', kind: 'image', width: 100, height: 200 }),
    ]);
    expect(
      getAttachmentsToAdd({ currentAttachments: current, nextSnapshot: next })
    ).toEqual([
      {
        entity_id: 'b',
        entity_type: 'static/image',
        width: 100,
        height: 200,
      },
    ]);
  });

  it('maps document kind to "document" entity type', () => {
    const result = getAttachmentsToAdd({
      currentAttachments: [],
      nextSnapshot: snapshot([
        inputAttachment({ id: 'doc-1', kind: 'document' }),
      ]),
    });
    expect(result).toEqual([
      {
        entity_id: 'doc-1',
        entity_type: 'document',
        width: null,
        height: null,
      },
    ]);
  });

  it('maps video kind to "static/video" entity type', () => {
    const result = getAttachmentsToAdd({
      currentAttachments: [],
      nextSnapshot: snapshot([inputAttachment({ id: 'vid-1', kind: 'video' })]),
    });
    expect(result[0]!.entity_type).toBe('static/video');
  });

  it('returns all when current is empty', () => {
    const next = snapshot([
      inputAttachment({ id: 'a' }),
      inputAttachment({ id: 'b' }),
    ]);
    const result = getAttachmentsToAdd({
      currentAttachments: [],
      nextSnapshot: next,
    });
    expect(result).toHaveLength(2);
  });

  it('handles simultaneous add and delete correctly', () => {
    const current = [
      attachment({ entity_id: 'a' }),
      attachment({ entity_id: 'b' }),
    ];
    const next = snapshot([
      inputAttachment({ id: 'a' }),
      inputAttachment({ id: 'c', kind: 'image' }),
    ]);
    const toDelete = getAttachmentIdsToDelete({
      currentAttachments: current,
      nextSnapshot: next,
    });
    const toAdd = getAttachmentsToAdd({
      currentAttachments: current,
      nextSnapshot: next,
    });
    expect(toDelete).toEqual(['att-b']);
    expect(toAdd).toEqual([
      {
        entity_id: 'c',
        entity_type: 'static/image',
        width: null,
        height: null,
      },
    ]);
  });
});
