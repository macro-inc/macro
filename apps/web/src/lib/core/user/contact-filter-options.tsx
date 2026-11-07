import type { SearchableOptionSource } from '@app/features/next-soup/soup-view/filters-bar/option-source';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import type { ContactIdFilterSource } from '@queries/contacts/filter-source';
import { type Accessor, createMemo } from 'solid-js';
import { macroIdToEmail, tryMacroId } from './macroId';

/** UI adapter over bounded contacts. Selected IDs (including missing values)
 * and self are explicit pins, not additional directory/catalog retention. */
export function createContactFilterOptions(
  source: ContactIdFilterSource,
  selected: Accessor<readonly string[]>
): SearchableOptionSource {
  let previousWindow = '';
  let order: string[] = [];
  const rows = createMemo(() => {
    const suggestions = source.suggestions.data()?.users ?? [];
    const known = new Map(
      [...suggestions, ...(source.selection.data()?.users ?? [])].map(
        (user) => [user.id, user]
      )
    );
    const ids = [...new Set(selected())];
    const canonicalSelected = new Set(ids.map((id) => id.toLowerCase()));
    const viewer = source.viewer();
    if (viewer && !canonicalSelected.has(viewer)) {
      ids.push(viewer);
      canonicalSelected.add(viewer);
    }
    for (const person of suggestions)
      if (!canonicalSelected.has(person.id)) {
        ids.push(person.id);
        canonicalSelected.add(person.id);
      }
    const matching = new Set(suggestions.map((user) => user.id));
    const query = source.suggestions.search().trim().toLowerCase();
    const window = JSON.stringify([
      viewer,
      query,
      suggestions.map((user) => user.id),
    ]);
    if (window !== previousWindow) {
      previousWindow = window;
      order = ids;
    } else {
      // Toggling a visible checkbox must not move it beneath the pointer.
      // Retain only this window and explicit selections, never prior pages.
      const next = new Set(ids);
      const previous = new Set(order);
      order = [
        ...order.filter((id) => next.has(id)),
        ...ids.filter((id) => !previous.has(id)),
      ];
    }
    return order.map((id) => {
      const canonical = id.toLowerCase();
      const user = known.get(canonical);
      const macroId = tryMacroId(canonical);
      const email = user?.email ?? (macroId ? macroIdToEmail(macroId) : id);
      const name = user?.name || email.split('@')[0] || email;
      const label =
        canonical === viewer
          ? t('viewMenus.contactMe', { name })
          : user?.name || email;
      return {
        option: {
          id,
          label,
          icon: macroId
            ? () => (
                <UserIcon
                  id={macroId}
                  name={name}
                  size="sm"
                  suppressClick
                  showTooltip={false}
                />
              )
            : undefined,
        },
        visible:
          !query ||
          matching.has(canonical) ||
          label.toLowerCase().includes(query) ||
          email.toLowerCase().includes(query),
      };
    });
  });
  return {
    options: () => rows().map((row) => row.option),
    windowKey: source.suggestions.windowKey,
    visibleIds: () =>
      rows()
        .filter((row) => row.visible)
        .map((row) => row.option.id),
    search: source.suggestions.search,
    setSearch: source.suggestions.setSearch,
    loading: source.suggestions.loading,
    error: () => !!source.suggestions.error(),
    incomplete: () => {
      const page = source.suggestions.data();
      return (
        !!page?.offline ||
        page?.sync === 'partial' ||
        page?.sync === 'cold' ||
        !!source.selection.data()?.offline ||
        !!source.selection.error()
      );
    },
    hasNext: () => !!source.suggestions.data()?.nextCursor,
    next: source.suggestions.next,
    retry: () =>
      Promise.all([source.suggestions.retry(), source.selection.retry()]),
  };
}
