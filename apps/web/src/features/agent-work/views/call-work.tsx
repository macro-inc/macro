import { CollapsibleSection } from '@app/components/view-shell/CollapsibleSection';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { UserGroup } from '@core/component/UserGroup';
import { UserIcon } from '@core/component/UserIcon';
import { enableAgentWork } from '@core/constant/featureFlags';
import { getDisplayName, isAgentAccount, tryMacroId } from '@core/user';
import XIcon from '@icon/system/regular/x.svg';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import { Button } from '@ui';
import { type Accessor, createSignal, For, Show } from 'solid-js';
import { WorkIdentity } from '../components/WorkIdentity';
import { WorkList } from '../components/WorkList';
import type { WorkItem } from '../core/work-item';
import { callWorkAccounts } from '../core/work-visibility';
import { createRegisteredWork } from '../primitives/create-registered-work';
import { createWorkArrivals } from '../primitives/create-work-arrivals';
import { useOpenWorkItem } from './open-work-item';
import { useWorkClient } from './use-work-client';

/** How long the active work prompt stays over the call. */
const WORK_PROMPT_DURATION_MS = 8_000;

type CallPanelTab = 'chat' | 'participants' | 'work';

/** The Work state of a call: who has work, and what its panel should show. */
export function createCallWork(options: {
  accountIds: Accessor<readonly (string | undefined)[]>;
  selectedTab: Accessor<CallPanelTab>;
  panelOpen: Accessor<boolean>;
  canChat: Accessor<boolean>;
}) {
  const flag = useFeatureFlag(enableAgentWork);
  const work = createRegisteredWork({
    client: useWorkClient(),
    accountIds: () => callWorkAccounts(options.accountIds()),
    enabled: () => flag().enabled,
    onReconnected: subscribeGraphqlSoupReconnected,
  });
  const hasWork = () => work.accountsWithWork().length > 0;
  const activeTab = (): CallPanelTab => {
    const tab = options.selectedTab();
    if (tab === 'work' && hasWork()) return 'work';
    if (!options.canChat()) return 'participants';
    return tab === 'work' ? 'chat' : tab;
  };

  const viewingWork = () => options.panelOpen() && activeTab() === 'work';
  const arrivals = createWorkArrivals({
    loaded: work.loaded,
    accountsWithWork: work.accountsWithWork,
    announceInitial: true,
    durationMs: WORK_PROMPT_DURATION_MS,
  });

  return {
    work,
    hasWork,
    activeTab,
    arrivals,
    showTabDot: () => hasWork() && !viewingWork(),
    showButtonDot: () => hasWork() && !options.panelOpen(),
    showPrompt: () => !viewingWork() && arrivals.arrivals().length > 0,
  };
}

function CallWorkSection(props: {
  accountId: string;
  items: readonly WorkItem[];
  isSpeaking: boolean;
}) {
  const [open, setOpen] = createSignal(true);
  const openItem = useOpenWorkItem();

  return (
    <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger class="flex-1">
          <WorkIdentity
            name={getDisplayName(tryMacroId(props.accountId))}
            isAgent={isAgentAccount(tryMacroId(props.accountId))}
            avatar={
              <UserIcon
                id={props.accountId}
                size="md"
                suppressClick
                showTooltip={false}
              />
            }
            note={
              <Show when={props.isSpeaking}>
                <span class="shrink-0 text-xs font-medium text-accent">
                  {t('calls.speaking')}
                </span>
              </Show>
            }
          />
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <nav class="flex flex-col gap-(--sidebar-row-gap)">
          <WorkList items={props.items} onOpen={openItem} />
        </nav>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

/** The call panel's Work tab: one section per participant with work. */
export function CallWorkTab(props: {
  accounts: readonly string[];
  itemsFor: (accountId: string) => readonly WorkItem[];
  isSpeaking: (accountId: string) => boolean;
}) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1 pb-3">
      <For each={props.accounts}>
        {(accountId) => (
          <CallWorkSection
            accountId={accountId}
            items={props.itemsFor(accountId)}
            isSpeaking={props.isSpeaking(accountId)}
          />
        )}
      </For>
    </div>
  );
}

/**
 * Announces active work over the call stage, above the local video tile that
 * holds the bottom-right corner. Specific to calls: it belongs to the room,
 * not to the app's notifications.
 */
export function CallWorkPrompt(props: {
  accounts: readonly string[];
  onView: () => void;
  onDismiss: () => void;
}) {
  return (
    <div class="menu-surface absolute right-4 bottom-33 z-30 flex items-center gap-1 p-1 pointer-events-auto">
      <button
        type="button"
        class="flex h-9 min-w-0 items-center gap-2 rounded-lg pr-2 pl-1.5 text-sm font-medium text-ink outline-none not-touch:hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent [--avatar-group-separator:var(--color-menu)]"
        onClick={props.onView}
      >
        <UserGroup userIds={[...props.accounts]} size="md" suppressClick />
        <span class="truncate">{t('agentWork.viewActiveWork')}</span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('agentWork.dismissActiveWork')}
        onClick={props.onDismiss}
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>
  );
}
