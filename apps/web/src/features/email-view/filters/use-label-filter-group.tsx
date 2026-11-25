import type { ListFilterGroup } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useEmailLinksContext } from '@core/context/emailLinks';
import { LabelIcon } from '@property/tags/LabelPill';
import { useEmailInboxLabels } from '@queries/email/label-names';
import { type Accessor, createMemo } from 'solid-js';
import { LABEL_FACET_ID } from './email-label-facet';

export type LabelFilterGroup = ListFilterGroup<typeof LABEL_FACET_ID, string>;

/**
 * The Labels group of Mail's filter menu: the labels people made, by their
 * whole names, each inbox's together. With labels in several inboxes, each
 * shows its inbox's avatar, so same-named labels stay apart. Undefined while
 * there are none.
 */
export function useLabelFilterGroup(): Accessor<LabelFilterGroup | undefined> {
  const labels = useEmailInboxLabels();
  const { links } = useEmailLinksContext();
  const addressOf = (linkId: string) =>
    links().find((link) => link.id === linkId)?.email_address ?? '';

  return createMemo((): LabelFilterGroup | undefined => {
    const all = labels();
    if (all.length === 0) return undefined;
    const several = new Set(all.map((label) => label.linkId)).size > 1;
    return {
      id: LABEL_FACET_ID,
      label: t('emailViews.labels'),
      searchPlaceholder: t('emailViews.labelsPlaceholder'),
      preserveOrder: true,
      options: all.map((label) => ({
        id: label.id,
        label: label.fullName,
        icon: several
          ? () => (
              <UserIcon
                {...inboxIconProps(addressOf(label.linkId))}
                size="sm"
                suppressClick
                showTooltip={false}
              />
            )
          : () => <LabelIcon class="size-4" />,
      })),
    };
  });
}
