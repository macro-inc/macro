import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { soupItemMatchesInboxTab } from './inbox-item-filter';

function emailItem(
  overrides: { isDraft?: boolean; labelNames?: string[] } = {}
): SoupApiItem {
  return {
    tag: 'emailThread',
    data: {
      id: 'thread-1',
      isDraft: overrides.isDraft ?? false,
      labels: (overrides.labelNames ?? []).map((name) => ({
        name,
        providerLabelId: name,
      })),
    },
  } as unknown as SoupApiItem;
}

const taskItem = {
  tag: 'document',
  data: { id: 'task-1', subType: { type: 'task' } },
} as unknown as SoupApiItem;

const reminderItem = {
  tag: 'reminder',
  data: { id: 'reminder-1' },
} as unknown as SoupApiItem;

// The macro-3272 shape: a GitHub PR notification email (CATEGORY_UPDATES,
// often also Gmail's IMPORTANT) restored into the cache by a websocket
// notification must not enter the Signal feed.
const githubNoiseEmail = emailItem({
  labelNames: ['CATEGORY_UPDATES', 'IMPORTANT', 'INBOX', 'UNREAD'],
});

describe('signal tab', () => {
  it('rejects category-labeled noise emails, IMPORTANT notwithstanding', () => {
    expect(soupItemMatchesInboxTab(githubNoiseEmail, 'signal')).toBe(false);
  });

  it('accepts personal emails', () => {
    expect(
      soupItemMatchesInboxTab(
        emailItem({ labelNames: ['CATEGORY_PERSONAL', 'INBOX'] }),
        'signal'
      )
    ).toBe(true);
  });

  it('accepts uncategorized emails', () => {
    expect(
      soupItemMatchesInboxTab(emailItem({ labelNames: ['INBOX'] }), 'signal')
    ).toBe(true);
  });

  it('accepts drafts regardless of labels', () => {
    expect(
      soupItemMatchesInboxTab(
        emailItem({ isDraft: true, labelNames: ['CATEGORY_UPDATES'] }),
        'signal'
      )
    ).toBe(true);
  });

  it('accepts threads the viewer replied into, even when categorized', () => {
    expect(
      soupItemMatchesInboxTab(
        emailItem({ labelNames: ['SENT', 'CATEGORY_UPDATES'] }),
        'signal'
      )
    ).toBe(true);
  });

  it('accepts non-email items', () => {
    expect(soupItemMatchesInboxTab(taskItem, 'signal')).toBe(true);
  });
});

describe('noise tab', () => {
  it('accepts category-labeled noise emails', () => {
    expect(soupItemMatchesInboxTab(githubNoiseEmail, 'noise')).toBe(true);
  });

  it('rejects signal emails', () => {
    expect(
      soupItemMatchesInboxTab(
        emailItem({ labelNames: ['CATEGORY_PERSONAL'] }),
        'noise'
      )
    ).toBe(false);
  });

  it('rejects non-email items', () => {
    expect(soupItemMatchesInboxTab(taskItem, 'noise')).toBe(false);
  });
});

describe('all tab', () => {
  it('accepts emails of either importance', () => {
    expect(soupItemMatchesInboxTab(githubNoiseEmail, 'all')).toBe(true);
    expect(
      soupItemMatchesInboxTab(
        emailItem({ labelNames: ['CATEGORY_PERSONAL'] }),
        'all'
      )
    ).toBe(true);
  });
});

describe('reminders tab', () => {
  it('accepts only reminders', () => {
    expect(soupItemMatchesInboxTab(reminderItem, 'reminders')).toBe(true);
    expect(soupItemMatchesInboxTab(taskItem, 'reminders')).toBe(false);
    expect(soupItemMatchesInboxTab(githubNoiseEmail, 'reminders')).toBe(false);
  });
});
