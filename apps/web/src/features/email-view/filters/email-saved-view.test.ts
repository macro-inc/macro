import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import { describe, expect, it } from 'vitest';
import {
  captureEmailSavedView,
  decodeEmailSavedView,
  EMPTY_EMAIL_SAVED_VIEW_FILTERS,
  emailSavedViewsEqual,
  materializeEmailSavedView,
  readEmailSavedView,
} from './email-saved-view';

const INBOX = '0199a1b2-0000-7000-8000-000000000001';
const TAG_DEFINITION = '0199a1b2-0000-7000-8000-0000000000aa';
const TAG_OPTION = '0199a1b2-0000-7000-8000-0000000000bb';

describe('captureEmailSavedView', () => {
  it('saves a filtered Signal tab as an inbox-only definition and reopens it on All', () => {
    const captured = captureEmailSavedView({
      tab: 'important',
      inboxIds: [INBOX.toUpperCase()],
      facets: {
        read: ['unread'],
        attachments: ['attachment-pdf'],
        tags: [TAG_OPTION],
      },
      conditions: undefined,
      context: {
        tagPropertyDefinitionByOptionId: new Map([
          [TAG_OPTION, TAG_DEFINITION],
        ]),
      },
    });

    expect(captured._unsafeUnwrap().filters).toEqual({
      ...EMPTY_EMAIL_SAVED_VIEW_FILTERS,
      inboxIds: [INBOX],
      importance: 'signal',
      read: 'unread',
      done: 'not-done',
      attachments: ['attachment-pdf'],
      tags: [{ optionId: TAG_OPTION, propertyDefinitionId: TAG_DEFINITION }],
    });
    const restored = materializeEmailSavedView(captured._unsafeUnwrap());
    expect(restored.inboxIds).toEqual([INBOX]);
    expect(restored.facets).toEqual({
      read: ['unread'],
      done: ['not-done'],
      attachments: ['attachment-pdf'],
      calendar: [],
      tags: [TAG_OPTION],
    });
    expect(restored.conditions.importance).toBe('signal');
    expect(restored.tagBindings.get(TAG_OPTION)).toBe(TAG_DEFINITION);
  });

  it('saves an alias as its inbox plus the address in every direction', () => {
    const captured = captureEmailSavedView({
      tab: 'all',
      inboxIds: [INBOX],
      aliasFilter: { inboxId: INBOX, emailAddress: 'Alias@Example.com' },
      facets: {},
      conditions: undefined,
      context: EMPTY_TAG_FACET_CONTEXT,
    });

    const filters = captured._unsafeUnwrap().filters;
    expect(filters.inboxIds).toEqual([INBOX]);
    expect(filters.participants).toEqual([
      { type: 'address', email: 'alias@example.com' },
    ]);
    expect(filters.participantFields).toEqual(['from', 'to', 'cc', 'bcc']);
  });

  it('keeps an open view’s conditions and the edits made on top of them', () => {
    const captured = captureEmailSavedView({
      tab: 'all',
      inboxIds: undefined,
      facets: { done: ['done'] },
      conditions: {
        participants: [{ type: 'domain', domain: 'Example.com' }],
        participantFields: ['from'],
        subject: ['FYI'],
        receivedWithinDays: 7,
        starred: false,
      },
      context: EMPTY_TAG_FACET_CONTEXT,
    });

    expect(captured._unsafeUnwrap().filters).toMatchObject({
      inboxIds: [],
      participants: [{ type: 'domain', domain: 'example.com' }],
      participantFields: ['from'],
      subject: ['FYI'],
      receivedWithinDays: 7,
      done: 'done',
    });
  });

  it('refuses what a view cannot reproduce instead of saving fewer filters', () => {
    const capture = (
      overrides: Partial<Parameters<typeof captureEmailSavedView>[0]>
    ) =>
      captureEmailSavedView({
        tab: 'all',
        inboxIds: undefined,
        facets: {},
        conditions: undefined,
        context: EMPTY_TAG_FACET_CONTEXT,
        ...overrides,
      });

    expect(capture({ tab: 'sent' }).isErr()).toBe(true);
    expect(capture({ tab: 'focus' }).isErr()).toBe(true);
    expect(capture({ facets: { tags: [TAG_OPTION] } }).isErr()).toBe(true);
    expect(capture({ inboxIds: [] }).isErr()).toBe(true);
    expect(capture({ facets: { focus: ['focus-reply-needed'] } }).isErr()).toBe(
      true
    );
    expect(
      capture({
        aliasFilter: { inboxId: INBOX, emailAddress: 'alias@example.com' },
        conditions: {
          participants: [{ type: 'viewer' }],
          participantFields: ['to'],
          subject: [],
          starred: false,
        },
      }).isErr()
    ).toBe(true);
  });
});

describe('readEmailSavedView', () => {
  it('applies supported filters from a newer definition and names what it skipped', () => {
    const read = readEmailSavedView({
      kind: 'email',
      version: 1,
      filters: {
        ...EMPTY_EMAIL_SAVED_VIEW_FILTERS,
        importance: 'signal',
        participants: [
          { type: 'address', email: 'principal@example.com' },
          { type: 'team', id: 'not-yet-supported' },
        ],
        aiLabel: 'action-required',
      },
    });

    expect(read.config.filters.importance).toBe('signal');
    expect(read.config.filters.participants).toEqual([
      { type: 'address', email: 'principal@example.com' },
    ]);
    expect(read.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['filters.aiLabel'])
    );
    expect(read.issues.length).toBeGreaterThan(1);
  });

  it('opens an unknown definition type unrestricted, with an issue', () => {
    const read = readEmailSavedView({ kind: 'tasks', version: 1, filters: {} });

    expect(read.config.filters).toEqual(EMPTY_EMAIL_SAVED_VIEW_FILTERS);
    expect(read.issues.length).toBeGreaterThan(0);
  });

  it('rejects one tag bound to two property definitions', () => {
    const decoded = decodeEmailSavedView({
      kind: 'email',
      version: 1,
      filters: {
        ...EMPTY_EMAIL_SAVED_VIEW_FILTERS,
        tags: [
          { optionId: TAG_OPTION, propertyDefinitionId: TAG_DEFINITION },
          { optionId: TAG_OPTION, propertyDefinitionId: INBOX },
        ],
      },
    });

    expect(decoded.isErr()).toBe(true);
  });
});

describe('emailSavedViewsEqual', () => {
  it('ignores the order and repetition of set-valued filters', () => {
    const base = {
      kind: 'email' as const,
      version: 1 as const,
      filters: {
        ...EMPTY_EMAIL_SAVED_VIEW_FILTERS,
        participantFields: ['cc' as const, 'from' as const],
        subject: ['fyi', 'Action'],
      },
    };

    expect(
      emailSavedViewsEqual(base, {
        ...base,
        filters: {
          ...base.filters,
          participantFields: ['from', 'cc', 'from'],
          subject: ['Action', 'FYI'],
        },
      })
    ).toBe(true);
    expect(
      emailSavedViewsEqual(base, {
        ...base,
        filters: { ...base.filters, starred: true },
      })
    ).toBe(false);
  });
});
