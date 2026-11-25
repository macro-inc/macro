import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { formatLocale, t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { enableCrmMerge } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import GitMergeIcon from '@icon/system/regular/git-merge.svg';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Button, openDialog } from '@ui';
import { Show } from 'solid-js';
import { MAX_MERGE_SOURCES } from './core/merge';

/** A company offered for a merge, with the domains that tell it apart. */
type MergeCandidate = { id: string; name: string; domains: string[] };

/** The companies of `entities` a merge can take, or none when any isn't one. */
export function mergeCandidates(entities: EntityData[]): MergeCandidate[] {
  const companies = entities.flatMap((entity) =>
    entity.type === 'crm_company' && !entity.hidden
      ? [
          {
            id: entity.id,
            name: entity.name,
            domains: entity.domains.map((domain) => domain.domain),
          },
        ]
      : []
  );
  return companies.length === entities.length &&
    companies.length <= MAX_MERGE_SOURCES + 1
    ? companies
    : [];
}

/** Whether this admin may merge companies: the rollout flag and their role. */
export function useCanMergeCompanies() {
  const flag = useFeatureFlag(enableCrmMerge);
  const admin = useIsTeamAdmin();
  return () => flag().enabled && admin();
}

/** Opens a merge of `companies`; one starts by picking the others. */
export function useOpenMergeCompanies() {
  const { openWithSplit } = useSplitLayout();
  // Loaded on open: the dialog's CRM wiring imports soup, which imports the
  // shared menus this is offered from.
  return async (companies: MergeCandidate[], onMerged?: () => void) => {
    const { AppMergeCompaniesDialog } = await import('./crm-merge-dialog');
    openDialog(
      AppMergeCompaniesDialog,
      {
        companies,
        onMerged: ({ survivor, merged }) => {
          onMerged?.();
          const names = new Intl.ListFormat(formatLocale(), {
            style: 'long',
            type: 'conjunction',
          }).format(merged.map((company) => company.name));
          const notice = toast.success(t('crm.mergeDone'), {
            subtext: t('crm.mergeDoneDetail', {
              count: merged.length,
              names,
              name: survivor.name,
            }),
            duration: isMobile() ? undefined : 8000,
            dismissStyle: 'icon',
            actions: [
              {
                label: t('crm.mergeOpen'),
                icon: ArrowSquareOutIcon,
                trailingIcon: true,
                onClick: () => {
                  if (notice !== undefined) toast.dismiss(notice);
                  openWithSplit({ type: 'company', id: survivor.id });
                },
              },
            ],
          });
        },
      },
      { key: 'crm-merge-companies' }
    );
  };
}

/** The selection toolbar's Merge, for two or more companies. */
export function CrmMergeSelectionButton(props: {
  selected: EntityData[];
  onMerged: () => void;
}) {
  const canMerge = useCanMergeCompanies();
  const openMerge = useOpenMergeCompanies();
  const companies = () => mergeCandidates(props.selected);
  return (
    <Show when={canMerge() && companies().length > 1}>
      <Button
        variant="secondary"
        class="p-1 px-2 bg-surface"
        onClick={() =>
          fireAndForget(openMerge(companies(), props.onMerged), 'crm')
        }
      >
        <GitMergeIcon class="size-4" />
        {t('crm.mergeButton')}
      </Button>
    </Show>
  );
}
