import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_REMINDER_DETAIL_ROUTE_ID,
  openReminderDetail,
  REMINDER_DETAIL_COMPONENT_ID,
  REMINDER_DETAIL_ROUTE_ID,
  reminderDetailDestination,
  reminderDetailPath,
  reminderDetailUrl,
  reminderIdFromDetailContent,
} from './reminder-navigation';
import { reminderSourceContent } from './reminder-source';

vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (item: {
    referencedEntity: { type: string; fileType?: string; subType?: string };
  }) =>
    item.referencedEntity.subType ??
    item.referencedEntity.fileType ??
    item.referencedEntity.type,
}));

afterEach(() => setGlobalSplitManager(undefined));

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

  it('recognizes standalone and Home reminder content', () => {
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
  it.each([false, true])(
    'navigates through the manager-owned route (new split: %s)',
    (openInNewSplit) => {
      const openWithSplit = vi.fn(() => ({ status: 'navigating' as const }));
      const handle = { id: 'source' } as SplitHandle;
      const onApplied = vi.fn();
      const manager = { openWithSplit } as unknown as SplitManager;

      const result = openReminderDetail('reminder-1', {
        manager,
        handle,
        openInNewSplit,
        mergeHistory: true,
        referredFrom: 'home',
        onApplied,
      });

      expect(result).toEqual({ status: 'navigating' });
      expect(openWithSplit).toHaveBeenCalledExactlyOnceWith(
        reminderDetailDestination('reminder-1').content,
        {
          activate: true,
          preferNewSplit: openInNewSplit,
          handle,
          mergeHistory: true,
          referredFrom: 'home',
          search: {},
          onApplied,
        }
      );
    }
  );

  it('reports unavailable when the app has no split manager', () => {
    expect(openReminderDetail('reminder-1')).toEqual({
      status: 'unavailable',
    });
  });
});

it('opens attached sources while retaining explicit reminder detail destinations', () => {
  expect(
    reminderSourceContent({ referencedEntity: { id: 'email', type: 'email' } })
  ).toEqual({ type: 'email', id: 'email' });
  expect(
    reminderSourceContent({
      referencedEntity: {
        id: 'task',
        type: 'document',
        fileType: 'md',
        subType: 'task',
      },
    })
  ).toEqual({ type: 'task', id: 'task' });
  expect(reminderSourceContent({})).toBeUndefined();
  expect(reminderDetailDestination('reminder').content.id).toBe(
    'reminder-detail'
  );
});
