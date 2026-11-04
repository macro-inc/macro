import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { describe, expect, it } from 'vitest';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from './previewTarget';

const record = (type: 'crm_company' | 'crm_contact', tag?: string) =>
  ({
    id: 'record',
    type,
    notifications: () =>
      tag
        ? [
            {
              id: 'n-1',
              state: 'unseen',
              created_at: '2026-03-01T10:00:00Z',
              notification_metadata: {
                tag,
                content: { messageId: 'comment-1' },
              },
            },
          ]
        : [],
  }) as unknown as PreviewPanelSelection;

describe('previewBlockTarget', () => {
  it.each([
    ['crm_company', 'company'],
    ['crm_contact', 'contact'],
  ] as const)(
    'opens a %s at the comment its notification is about',
    (type, blockType) => {
      expect(previewBlockTarget(record(type, 'crm_discussion'))).toMatchObject({
        blockType,
        blockId: 'record',
        params: { [COMMENT_LINK_PARAM]: 'comment-1' },
      });
    }
  );

  it('opens a record with no comment notification at the record', () => {
    expect(previewBlockTarget(record('crm_company')).params).toBeUndefined();
    expect(
      previewBlockTarget(record('crm_contact', 'task_assigned')).params
    ).toBeUndefined();
  });
});
