import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useEmailLinksQuery } from '@queries/email/link';
import { type Accessor, createMemo } from 'solid-js';
import type { SearchableOption } from './searchable-multi-select';

/**
 * Shared mechanics for a multi-select over the user's linked inboxes (mail
 * toolbar selector, search facet). The selection is tri-state: `undefined` =
 * all inboxes (default — every box checked), `[]` = explicitly none, a
 * subset = those. Re-checking every inbox collapses back to the default, so
 * a checked box always means the inbox is included. Callers own where the
 * selection lives and how the value is rendered.
 */
export function useInboxPicker(args: {
  selectedIds: Accessor<string[] | undefined>;
  setSelectedIds: (ids: string[] | undefined) => void;
}) {
  const linksQuery = useEmailLinksQuery();

  const options = createMemo((): SearchableOption[] =>
    (linksQuery.data?.links ?? [])
      .map((link) => ({
        id: link.id,
        label: link.email_address,
        icon: () => (
          <UserIcon
            {...inboxIconProps(link.email_address)}
            photoUrl={link.photo_url ?? undefined}
            size="sm"
            suppressClick
            showTooltip={false}
          />
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  return {
    options,
    hasMultiple: () => options().length > 1,
    activeIds: () => args.selectedIds() ?? options().map((o) => o.id),
    onChange: (ids: string[]) =>
      args.setSelectedIds(ids.length === options().length ? undefined : ids),
    selectOnly: (id: string) => args.setSelectedIds([id]),
    isDefault: () => args.selectedIds() === undefined,
    reset: () => args.setSelectedIds(undefined),
  };
}
