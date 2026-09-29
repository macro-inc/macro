import type { SplitRouter } from '@app/lib/split-router';
import type {
  SplitId,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { describe, expect, it, vi } from 'vitest';
import {
  HOME_REMINDER_DETAIL_ROUTE_ID,
  LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX,
  openReminderDetail,
  REMINDER_DETAIL_COMPONENT_ID,
  REMINDER_DETAIL_ROUTE_ID,
  reminderDetailDestination,
  reminderDetailPath,
  reminderDetailUrl,
  reminderIdFromDetailContent,
  reminderIdFromLegacyComponent,
} from './reminder-navigation';

describe('reminder detail destination', () => {
  it('uses a canonical route while retaining route-backed split content', () => {
    const destination = reminderDetailDestination('reminder-1');

    expect(destination).toEqual({
      kind: 'reminder-detail',
      reminderId: 'reminder-1',
      content: {
        type: 'component',
        id: REMINDER_DETAIL_COMPONENT_ID,
        params: { reminderId: 'reminder-1' },
        entryMetadata: {
          route: {
            matches: [
              {
                id: REMINDER_DETAIL_ROUTE_ID,
                params: { reminderId: 'reminder-1' },
              },
            ],
          },
        },
      },
    });
    expect(reminderDetailPath('reminder 1')).toBe('/reminder/reminder%201');
    expect(new URL(reminderDetailUrl('reminder 1')).pathname).toBe(
      '/app/reminder/reminder%201'
    );
  });

  it('decodes legacy links only at the compatibility boundary', () => {
    expect(
      reminderIdFromLegacyComponent(
        `${LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX}reminder-1`
      )
    ).toBe('reminder-1');
    expect(reminderIdFromLegacyComponent('reminders')).toBeUndefined();
    expect(
      reminderIdFromLegacyComponent(LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX)
    ).toBeUndefined();
  });

  it('recognizes standalone, Home, and legacy reminder content', () => {
    expect(
      reminderIdFromDetailContent(
        reminderDetailDestination('standalone').content
      )
    ).toBe('standalone');
    expect(
      reminderIdFromDetailContent({
        type: 'component',
        id: 'home',
        entryMetadata: {
          route: {
            matches: [
              { id: 'view-home', params: {} },
              {
                id: HOME_REMINDER_DETAIL_ROUTE_ID,
                params: { reminderId: 'inline' },
              },
            ],
          },
        },
      })
    ).toBe('inline');
    expect(
      reminderIdFromDetailContent({
        type: 'component',
        id: `${LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX}legacy`,
      })
    ).toBe('legacy');
  });

  it('prefers current route identity over preserved component params', () => {
    expect(
      reminderIdFromDetailContent({
        type: 'component',
        id: REMINDER_DETAIL_COMPONENT_ID,
        params: { reminderId: 'reminder-a' },
        entryMetadata: {
          route: {
            matches: [
              {
                id: REMINDER_DETAIL_ROUTE_ID,
                params: { reminderId: 'reminder-b' },
              },
            ],
          },
        },
      })
    ).toBe('reminder-b');
  });
});

describe('openReminderDetail', () => {
  it.each([
    [false, 'current'],
    [true, 'new-split'],
  ] as const)(
    'navigates through route claims (new split: %s)',
    (openInNewSplit, target) => {
      const navigate = vi.fn();
      const manager = {
        activeSplitId: () => 'source',
      } as unknown as SplitManager;
      const router = { navigate } as unknown as Pick<
        SplitRouter<SplitId>,
        'navigate'
      >;

      openReminderDetail('reminder-1', {
        manager,
        router,
        openInNewSplit,
        mergeHistory: true,
      });

      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        'source',
        '/reminder/reminder-1',
        { replace: true, target }
      );
    }
  );

  it('uses route-aware identity in the startup fallback', () => {
    const activate = vi.fn();
    const openWithSplit = vi.fn();
    const manager = {
      activeSplitId: () => undefined,
      splits: () => [
        {
          id: 'home',
          content: {
            type: 'component',
            id: 'home',
            entryMetadata: {
              route: {
                matches: [
                  {
                    id: HOME_REMINDER_DETAIL_ROUTE_ID,
                    params: { reminderId: 'reminder-1' },
                  },
                ],
              },
            },
          },
        },
      ],
      getSplit: () => ({ activate }),
      openWithSplit,
    } as unknown as SplitManager;

    openReminderDetail('reminder-1', { manager });

    expect(activate).toHaveBeenCalledOnce();
    expect(openWithSplit).not.toHaveBeenCalled();
  });
});
