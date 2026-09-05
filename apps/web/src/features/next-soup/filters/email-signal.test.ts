import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  emailItemLooksSignal,
  emailItemMatchesImportance,
} from './email-signal';

function emailData(
  overrides: { isDraft?: boolean; labelNames?: string[] } = {}
) {
  return {
    id: 'thread-1',
    isDraft: overrides.isDraft ?? false,
    labels: (overrides.labelNames ?? []).map((name) => ({
      name,
      providerLabelId: name,
    })),
  };
}

function emailItem(
  overrides: { isDraft?: boolean; labelNames?: string[] } = {}
): SoupApiItem {
  return {
    tag: 'emailThread',
    data: emailData(overrides),
  } as unknown as SoupApiItem;
}

const taskItem = {
  tag: 'document',
  data: { id: 'task-1', subType: { type: 'task' } },
} as unknown as SoupApiItem;

// The macro-3272 shape: a GitHub PR notification email (CATEGORY_UPDATES,
// often also Gmail's IMPORTANT).
const githubNoiseLabels = ['CATEGORY_UPDATES', 'IMPORTANT', 'INBOX', 'UNREAD'];
const githubNoiseData = emailData({ labelNames: githubNoiseLabels });
const githubNoiseEmail = emailItem({ labelNames: githubNoiseLabels });

describe('emailItemLooksSignal', () => {
  it('rejects category-labeled noise emails, IMPORTANT notwithstanding', () => {
    expect(emailItemLooksSignal(githubNoiseData)).toBe(false);
  });

  it('accepts personal emails', () => {
    expect(
      emailItemLooksSignal(
        emailData({ labelNames: ['CATEGORY_PERSONAL', 'INBOX'] })
      )
    ).toBe(true);
  });

  it('accepts uncategorized emails', () => {
    expect(emailItemLooksSignal(emailData({ labelNames: ['INBOX'] }))).toBe(
      true
    );
  });

  it('accepts drafts regardless of labels', () => {
    expect(
      emailItemLooksSignal(
        emailData({ isDraft: true, labelNames: ['CATEGORY_UPDATES'] })
      )
    ).toBe(true);
  });

  it('accepts threads the viewer replied into, even when categorized', () => {
    expect(
      emailItemLooksSignal(
        emailData({ labelNames: ['SENT', 'CATEGORY_UPDATES'] })
      )
    ).toBe(true);
  });
});

describe('emailItemMatchesImportance', () => {
  it('gates importance-filtered signal queries', () => {
    expect(emailItemMatchesImportance(githubNoiseEmail, true)).toBe(false);
    expect(
      emailItemMatchesImportance(
        emailItem({ labelNames: ['CATEGORY_PERSONAL'] }),
        true
      )
    ).toBe(true);
  });

  it('gates noise queries in the opposite direction', () => {
    expect(emailItemMatchesImportance(githubNoiseEmail, false)).toBe(true);
    expect(
      emailItemMatchesImportance(
        emailItem({ labelNames: ['CATEGORY_PERSONAL'] }),
        false
      )
    ).toBe(false);
  });

  it('passes non-email items and queries without an importance filter', () => {
    expect(emailItemMatchesImportance(taskItem, true)).toBe(true);
    expect(emailItemMatchesImportance(taskItem, false)).toBe(true);
    expect(emailItemMatchesImportance(githubNoiseEmail, undefined)).toBe(true);
  });
});
