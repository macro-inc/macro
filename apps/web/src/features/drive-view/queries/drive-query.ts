import {
  defineQueryFilters,
  type Query,
} from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import type { DriveSelection } from '../context/drive-source';

/** Match the legacy filter controller's base tab to the current Drive scope. */
export function driveFilterTab(state: DriveSelection) {
  const location = state.location;
  if (location.kind === 'folder') return location.id ? 'all' : 'folders';
  if (location.tab === 'owned' && state.scope !== 'default') return state.scope;
  return location.tab;
}

export function driveQuery(state: DriveSelection, userId: string | undefined) {
  const context = { userId, isTeamAdmin: false };
  const location = state.location;
  if (location.kind === 'folder') {
    if (!location.id) return getViewPreset('documents', 'folders', context)!;
    return {
      filters: defineQueryFilters({
        include: {
          projectId: [location.id],
          chatProjectId: [location.id],
          folderId: [location.id],
          emailProjectId: [location.id],
        },
        emailView: 'all',
      }),
      clientFilters: {},
    };
  }
  if (location.tab === 'recent') {
    const recent = getViewPreset('recent', undefined, context)!;
    const files = getViewPreset('documents', 'all', context)!;
    return {
      filters: {
        ...recent.filters,
        exclude: {
          ...recent.filters.exclude,
          subType: files.filters.exclude?.subType,
        },
        include: {
          ...recent.filters.include,
          isEmailAttachment:
            state.scope === 'all' ? undefined : state.scope === 'attachments',
        },
      } satisfies Query,
      clientFilters: { and: ['document-or-file'] },
    };
  }
  const tab = driveFilterTab(state);
  const preset =
    getViewPreset('documents', tab, context) ??
    getViewPreset('documents', 'all', context)!;
  if (state.scope === 'attachments') {
    return {
      ...preset,
      filters: {
        ...preset.filters,
        include: { ...preset.filters.include, isEmailAttachment: true },
      },
    };
  }
  if (state.scope === 'all') {
    return {
      ...preset,
      filters: {
        ...preset.filters,
        include: { ...preset.filters.include, isEmailAttachment: undefined },
      },
    };
  }
  return preset;
}
