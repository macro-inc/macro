import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { UserIcon } from '@core/component/UserIcon';
import { enableAgentWork } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getDisplayName, isAgentAccount, tryMacroId } from '@core/user';
import { subscribeGraphqlSoupReconnected } from '@service-storage/graphql-soup';
import {
  type Accessor,
  createContext,
  createMemo,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { Transition } from 'solid-transition-group';
import { WorkIdentity } from '../components/WorkIdentity';
import { WorkList } from '../components/WorkList';
import type { WorkItem } from '../core/work-item';
import { dmWorkAccount } from '../core/work-visibility';
import { createRegisteredWork } from '../primitives/create-registered-work';
import { createWorkArrivals } from '../primitives/create-work-arrivals';
import { useOpenWorkItem } from './open-work-item';
import { useWorkClient } from './use-work-client';

const ARRIVAL_DURATION_MS = 6_000;

type DmWork = {
  account: Accessor<string | undefined>;
  items: Accessor<readonly WorkItem[]>;
  arriving: Accessor<boolean>;
  dismissArrival: () => void;
};

const DmWorkContext = createContext<DmWork>();

/**
 * Owns a DM's Work and its side panel state, around the header and the body.
 * Everything inside stays inert unless the other account is an agent with work.
 */
export function DmWorkProvider(
  props: ParentProps<{
    isDirectMessage: boolean;
    participantIds: readonly string[];
  }>
) {
  const flag = useFeatureFlag(enableAgentWork);
  const viewerId = useUserId();
  const account = createMemo(() => {
    if (!flag().enabled) return undefined;

    return dmWorkAccount({
      isDirectMessage: props.isDirectMessage,
      participantIds: props.participantIds,
      viewerId: viewerId(),
      isAgentAccount: (id) => isAgentAccount(tryMacroId(id)),
    });
  });
  const accountIds = createMemo(() => {
    const id = account();
    return id ? [id] : [];
  });
  const work = createRegisteredWork({
    client: useWorkClient(),
    accountIds,
    enabled: () => account() !== undefined,
    onReconnected: subscribeGraphqlSoupReconnected,
  });
  const arrivals = createWorkArrivals({
    loaded: work.loaded,
    accountsWithWork: work.accountsWithWork,
    durationMs: ARRIVAL_DURATION_MS,
  });
  const value: DmWork = {
    account,
    items: () => work.byAccount().get(account() ?? '') ?? [],
    arriving: () => arrivals.arrivals().length > 0,
    dismissArrival: arrivals.dismiss,
  };

  return (
    <SidePanel.Root floating defaultOpen={false} persistKey="dm-work">
      <DmWorkContext.Provider value={value}>
        {props.children}
      </DmWorkContext.Provider>
    </SidePanel.Root>
  );
}

function ArrivalLabel(props: { account: string }) {
  const work = useContext(DmWorkContext);
  const panel = useSidePanel();

  return (
    <button
      type="button"
      class="flex h-7 max-w-56 min-w-0 shrink items-center gap-1.5 rounded-full border border-edge-button bg-control pr-2.5 pl-1 text-xs font-medium text-ink outline-none not-touch:hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => {
        work?.dismissArrival();
        panel?.setIsOpen(true);
      }}
    >
      <span class="relative flex shrink-0">
        <UserIcon
          id={props.account}
          size="md"
          suppressClick
          showTooltip={false}
        />
        <span
          aria-hidden="true"
          class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-accent ring-2 ring-control motion-safe:animate-pulse"
        />
      </span>
      <span class="min-w-0 truncate">
        {t('agentWork.startedWorking', {
          name: getDisplayName(tryMacroId(props.account)),
        })}
      </span>
    </button>
  );
}

/**
 * The panel toggle, once there's work. When work first appears it announces
 * itself beside the toggle for a moment, without opening a closed panel.
 */
export function DmWorkToggle() {
  const work = useContext(DmWorkContext);

  return (
    <Show when={work?.account() && (work?.items().length ?? 0) > 0}>
      <Transition
        appear
        enterActiveClass="transition-[opacity,translate] duration-200 ease-out motion-reduce:duration-0"
        enterClass="opacity-0 translate-x-2"
        enterToClass="opacity-100 translate-x-0"
        exitActiveClass="transition-opacity duration-150 ease-out motion-reduce:duration-0"
        exitClass="opacity-100"
        exitToClass="opacity-0"
      >
        <Show when={work?.arriving() && work?.account()}>
          {(account) => <ArrivalLabel account={account()} />}
        </Show>
      </Transition>
      <SidePanel.Toggle />
    </Show>
  );
}

/**
 * The floating side panel over a DM's body. It renders nothing of its own
 * until there's work, so the conversation underneath never remounts.
 */
export function DmWorkPanel() {
  const work = useContext(DmWorkContext);
  const open = useOpenWorkItem();

  return (
    <Show
      when={
        work?.account() && (work?.items().length ?? 0) > 0 && work?.account()
      }
    >
      {(account) => (
        <div class="pointer-events-none absolute inset-0">
          <SidePanel.Layout headerToggle={false} floating>
            <SidePanel.Section
              id="work"
              defaultOpen
              order={5}
              title={
                <WorkIdentity
                  isAgent
                  name={getDisplayName(tryMacroId(account()))}
                  avatar={
                    <UserIcon
                      id={account()}
                      size="md"
                      suppressClick
                      showTooltip={false}
                    />
                  }
                />
              }
            >
              <nav class="-mx-1 flex flex-col gap-(--sidebar-row-gap)">
                <WorkList items={work?.items() ?? []} onOpen={open} />
              </nav>
            </SidePanel.Section>
            <div />
          </SidePanel.Layout>
        </div>
      )}
    </Show>
  );
}
