import type { DriveState } from '@app/features/drive-view/core/types';
import { createDriveState } from '@app/features/drive-view/primitives/drive-state';
import type { SearchableOptionSourceFactory } from '@app/features/next-soup/soup-view/filters-bar/option-source';
import type { SearchableOption } from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import {
  contactFilterOptionsWithEmpty,
  createContactFilterOptions,
} from '@core/user/contact-filter-options';
import { createContactIdFilterSource } from '@queries/contacts/filter-source';
import { type Accessor, createSignal } from 'solid-js';

export { useContactFilterLabels } from '../../user/use-contact-filter-options';

export const VIEWER = 'macro|viewer@example.com';
export const SELECTED = 'macro|selected@example.com';
export const [driveValue, setDriveValue] = createSignal<DriveState>({
  location: { kind: 'tab', tab: 'shared' },
  scope: 'default',
  sort: 'updated_at',
  search: '',
  facets: {
    type: ['file-pdf'],
    'created-by': [SELECTED, 'unavailable-person'],
  },
  expandedFolderIds: [],
  favoritesOpen: true,
  databasesOpen: true,
  rootOpen: true,
});
const state = createDriveState({
  state: driveValue,
  setState: setDriveValue,
  folders: () => [],
  list: { reset: () => {} },
  showList: () => {},
});
export function createEmailFilters(): never {
  throw new Error('Notes fixture must not construct email filters');
}
export function useDriveView() {
  return { state };
}
export function useFeatureFlag() {
  return () => ({ enabled: true, loading: false });
}
export function useTagFilterGroup() {
  return () => ({ id: 'tags', label: 'Tags', options: [] });
}

export function useContactFilterOptionsWithEmpty(
  selected: Accessor<readonly string[]>,
  enabled: Accessor<boolean>,
  empty: Accessor<SearchableOption>
) {
  return contactFilterOptionsWithEmpty(
    useContactFilterOptions(
      () => selected().filter((id) => id !== empty().id),
      enabled
    ),
    () => VIEWER,
    empty
  );
}

export const [requests, setRequests] = createSignal(0);
export const useContactFilterOptions: SearchableOptionSourceFactory = (
  selected,
  enabled
) =>
  createContactFilterOptions(
    createContactIdFilterSource(
      () => ({ userId: VIEWER }),
      selected,
      enabled,
      async (viewer, _host, request, signal) => {
        signal.throwIfAborted();
        setRequests((count) => count + 1);
        const second = request.cursor?.source === 'server';
        const users = request.query
          ? [
              {
                id: 'macro|match@example.com',
                email: 'match@example.com',
                name: 'Broader match',
              },
            ]
          : Array.from({ length: 50 }, (_, index) => ({
              id: `macro|person${index + (second ? 50 : 0)}@example.com`,
              email: `person${index + (second ? 50 : 0)}@example.com`,
              name: `Person ${index + (second ? 50 : 0)}`,
            }));
        return {
          users,
          query: request.query,
          source: 'server',
          sync: 'unavailable',
          offline: false,
          nextCursor:
            second || request.query
              ? null
              : { source: 'server', userId: viewer, query: '', after: 'next' },
        };
      },
      async (_viewer, _host, lookup, signal) => {
        signal.throwIfAborted();
        return {
          users: lookup.values.map((id) => {
            let name = id.slice(6);
            if (id === VIEWER) name = 'Viewer';
            if (id === SELECTED) name = 'Selected Person';
            if (id === 'macro|match@example.com') name = 'Broader match';
            return { id: id.toLowerCase(), email: id.slice(6), name };
          }),
          unresolved: [],
          source: 'server',
          offline: false,
        };
      }
    ),
    selected
  );
