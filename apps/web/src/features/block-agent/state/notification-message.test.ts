import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { isNotificationMessage } from './notification-message';

const NOTIFICATION = [
  '<system_notification source="github" repo="github.com/macro-inc/macro" conclusion="success" checks="27" subscriptionType="github:ci:branch">',
  'All 27 CI checks completed without failures.',
  '</system_notification>',
].join('\n');

const message = (
  author: 'user' | 'agent',
  parts: FoldedMessage['parts']
): FoldedMessage =>
  ({
    turn: 1,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts,
    stop: null,
  }) as unknown as FoldedMessage;

describe('isNotificationMessage', () => {
  it('recognises a prompt Cursor wrote from a subscription event', () => {
    expect(
      isNotificationMessage(
        message('user', [{ kind: 'text', text: `\n${NOTIFICATION}\n` }])
      )
    ).toBe(true);
  });

  it('recognises several notifications delivered as one prompt', () => {
    expect(
      isNotificationMessage(
        message('user', [
          { kind: 'text', text: `${NOTIFICATION}\n\n${NOTIFICATION}` },
        ])
      )
    ).toBe(true);
  });

  it('leaves a prompt a person typed around a pasted notification as theirs', () => {
    expect(
      isNotificationMessage(
        message('user', [
          { kind: 'text', text: `Look at this:\n${NOTIFICATION}` },
        ])
      )
    ).toBe(false);
    expect(
      isNotificationMessage(
        message('user', [
          { kind: 'text', text: NOTIFICATION },
          { kind: 'text', text: 'and fix it' },
        ])
      )
    ).toBe(false);
  });

  it('never reads an agent reply or an empty message as a notification', () => {
    expect(
      isNotificationMessage(
        message('agent', [{ kind: 'text', text: NOTIFICATION }])
      )
    ).toBe(false);
    expect(isNotificationMessage(message('user', []))).toBe(false);
  });
});
