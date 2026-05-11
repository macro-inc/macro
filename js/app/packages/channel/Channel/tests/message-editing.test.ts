import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import { describe, expect, it, vi } from 'vitest';
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

describe('getAttachmentsToAdd', () => {
  it('maps each kind to the correct entity type', () => {
    const result = getAttachmentsToAdd({
      currentAttachments: [],
      nextSnapshot: snapshot([
        inputAttachment({ id: 'img', kind: 'image' }),
        inputAttachment({ id: 'vid', kind: 'video' }),
        inputAttachment({ id: 'doc', kind: 'document' }),
      ]),
    });
    expect(result.map((a) => [a.entity_id, a.entity_type])).toEqual([
      ['img', 'static/image'],
      ['vid', 'static/video'],
      ['doc', 'document'],
    ]);
  });

  it('handles simultaneous add and delete', () => {
    const current = [
      attachment({ entity_id: 'a' }),
      attachment({ entity_id: 'b' }),
    ];
    const next = snapshot([
      inputAttachment({ id: 'a' }),
      inputAttachment({ id: 'c', kind: 'image', width: 100, height: 200 }),
    ]);
    expect(
      getAttachmentIdsToDelete({
        currentAttachments: current,
        nextSnapshot: next,
      })
    ).toEqual(['att-b']);
    expect(
      getAttachmentsToAdd({ currentAttachments: current, nextSnapshot: next })
    ).toEqual([
      {
        entity_id: 'c',
        entity_type: 'static/image',
        width: 100,
        height: 200,
      },
    ]);
  });
});
