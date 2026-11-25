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
import {
  MAX_MERGE_SOURCES,
  type MergeCandidate,
  type MergeRecordType,
  type MergeSelection,
} from './core/merge';

type TypedCandidate = MergeCandidate & { recordType: MergeRecordType };

function candidate(entity: EntityData): TypedCandidate | undefined {
  if (entity.type === 'crm_company' && !entity.hidden)
    return {
      recordType: 'company',
      id: entity.id,
      name: entity.name,
      identifiers: entity.domains.map((domain) => domain.domain),
    };
  if (entity.type === 'crm_contact' && !entity.hidden)
    return {
      recordType: 'contact',
      id: entity.id,
      name: entity.name,
      identifiers: entity.email ? [entity.email] : [],
      company: entity.companyName ?? null,
    };
  return undefined;
}

/**
 * The records of `entities` a merge can take: all live companies or all live
 * people, at most eleven; otherwise none.
 */
export function mergeCandidates(
  entities: EntityData[]
): MergeSelection | undefined {
  const found = entities.map(candidate);
  const recordType = found[0]?.recordType;
  const records = found.filter(
    (record): record is TypedCandidate => record?.recordType === recordType
  );
  if (
    recordType === undefined ||
    records.length !== entities.length ||
    records.length > MAX_MERGE_SOURCES + 1
  )
    return undefined;
  return {
    recordType,
    records: records.map(({ recordType: _, ...record }) => record),
  };
}

/** A row menu's merge item: "Merge with…" for one record. */
export function mergeActionLabel(selection: MergeSelection): string {
  if (selection.records.length < 2) return t('crm.mergeWith');
  return selection.recordType === 'company'
    ? t('crm.mergeCompanies')
    : t('crm.mergePeople');
}

/** Whether this admin may merge records: the rollout flag and their role. */
export function useCanMerge() {
  const flag = useFeatureFlag(enableCrmMerge);
  const admin = useIsTeamAdmin();
  return () => flag().enabled && admin();
}

type MergeRequest = MergeSelection & { onMerged?: () => void };

// Menus and toolbars hand the merge to the one dialog the app layout mounts,
// where the app's CRM wiring is available, as the CRM create dialogs do.
const [mergeRequest, setMergeRequest] = createSignal<MergeRequest>();
const [mergeOpen, setMergeOpen] = createSignal(false);
let mergeLock: ReturnType<typeof useFocusLock> | undefined;
const lock = () => {
  mergeLock ??= useFocusLock('crm-merge');
  return mergeLock;
};

/** The merge the layout's dialog shows; it stays set while the dialog closes. */
export const recordMerge = {
  request: mergeRequest,
  open: mergeOpen,
  close() {
    lock().release();
    setMergeOpen(false);
  },
};

/** Opens a merge of the selected records; one starts by picking the others. */
export function openMerge(selection: MergeSelection, onMerged?: () => void) {
  if (!crmAccessAllowed()) return;
  lock().acquire();
  setMergeRequest({ ...selection, onMerged });
  setMergeOpen(true);
}

/** The selection toolbar's Merge, for two or more companies or people. */
export function CrmMergeSelectionButton(props: {
  selected: EntityData[];
  onMerged: () => void;
}) {
  const canMerge = useCanMerge();
  const selection = () => {
    const found = mergeCandidates(props.selected);
    return found && found.records.length > 1 ? found : undefined;
  };
  return (
    <Show when={canMerge() && selection()}>
      {(current) => (
        <Button
          variant="secondary"
          class="p-1 px-2 bg-surface"
          onClick={() => openMerge(current(), props.onMerged)}
        >
          <GitMergeIcon class="size-4" />
          {t('crm.mergeButton')}
        </Button>
      )}
    </Show>
  );
}
