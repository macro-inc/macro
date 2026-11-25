import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableCrmMerge } from '@core/constant/featureFlags';
import { useFocusLock } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import GitMergeIcon from '@icon/system/regular/git-merge.svg';
import { useIsTeamAdmin } from '@queries/team/teams';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
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

type MergeRequest = { companies: MergeCandidate[]; onMerged?: () => void };

// Menus and toolbars hand the merge to the one dialog the app layout mounts,
// where the app's CRM wiring is available, as the CRM create dialogs do.
const [mergeRequest, setMergeRequest] = createSignal<MergeRequest>();
const [mergeOpen, setMergeOpen] = createSignal(false);
let mergeLock: ReturnType<typeof useFocusLock> | undefined;
const lock = () => {
  mergeLock ??= useFocusLock('crm-merge-companies');
  return mergeLock;
};

/** The merge the layout's dialog shows; it stays set while the dialog closes. */
export const companyMerge = {
  request: mergeRequest,
  open: mergeOpen,
  close() {
    lock().release();
    setMergeOpen(false);
  },
};

/** Opens a merge of `companies`; one starts by picking the others. */
export function openMergeCompanies(
  companies: MergeCandidate[],
  onMerged?: () => void
) {
  if (!crmAccessAllowed()) return;
  lock().acquire();
  setMergeRequest({ companies, onMerged });
  setMergeOpen(true);
}

/** The selection toolbar's Merge, for two or more companies. */
export function CrmMergeSelectionButton(props: {
  selected: EntityData[];
  onMerged: () => void;
}) {
  const canMerge = useCanMergeCompanies();
  const companies = () => mergeCandidates(props.selected);
  return (
    <Show when={canMerge() && companies().length > 1}>
      <Button
        variant="secondary"
        class="p-1 px-2 bg-surface"
        onClick={() => openMergeCompanies(companies(), props.onMerged)}
      >
        <GitMergeIcon class="size-4" />
        {t('crm.mergeButton')}
      </Button>
    </Show>
  );
}
