import { setInviteModalOpen } from '@app/component/app-sidebar/invite-modal';
import { CommandState } from '@app/component/command';
import { setCreateMenuOpen } from '@app/component/Launcher';
import { ResponsiveDropdown } from '@app/component/SimpleDropdown';
import { globalSplitManager } from '@app/signal/splitLayout';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { ChatInputProvider } from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { setAutomationComposerOpen } from '@block-automation/component';
import { useSettingsState } from '@core/constant/SettingsState';
import type { AutomationEntity } from '@entity';
import { formatDateAndTime } from '@entity/utils/timestamp';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import MoreIcon from '@phosphor-icons/core/fill/dots-three-outline-fill.svg?component-solid';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

import { useUserContext } from '@core/context/user';

function openAutomationsView() {
  globalSplitManager()?.openWithSplit(
    { type: 'component', id: 'agents' },
    {
      activate: true,
      referredFrom: 'dashboard',
    }
  );
}

function openAutomation(automation: AutomationEntity) {
  globalSplitManager()?.openWithSplit(
    { type: 'automation', id: automation.id },
    {
      activate: true,
      referredFrom: 'dashboard',
    }
  );
}

function AutomationSummary(props: { automation: AutomationEntity }) {
  const status = () => {
    if (props.automation.isRunning) return 'Running';
    if (!props.automation.enabled) return 'Paused';
    return props.automation.nextRunAt
      ? `Next ${formatDateAndTime(props.automation.nextRunAt)}`
      : 'Active';
  };

  return (
    <button
      class="group w-full rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={() => openAutomation(props.automation)}
    >
      <div class="flex items-center gap-2">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted transition group-hover:text-ink">
          <RobotIcon class="size-3.5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-semibold text-ink">
            {props.automation.name}
          </p>
          <p class="mt-0.5 truncate text-xxs text-ink-muted">{status()}</p>
        </div>
      </div>
    </button>
  );
}

function HeroAutomationsPanel() {
  const automations = useAutomationEntities();
  const visibleAutomations = createMemo(() =>
    [...automations()]
      .sort((a, b) => {
        if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const aNext = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
        const bNext = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
        return aNext - bNext;
      })
      .slice(0, 3)
  );

  return (
    <aside class="absolute right-8 top-8 hidden w-72 text-left @6xl/hero:block">
      <div class="mb-2 flex items-center justify-between gap-2 px-2 py-1">
        <h2 class="text-sm font-semibold text-ink">Automations</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          class="group size-7 rounded-lg text-ink-extra-muted"
          label="View all automations"
          onClick={openAutomationsView}
        >
          <ArrowRightIcon class="size-4" />
        </Button>
      </div>

      <Show
        when={visibleAutomations().length > 0}
        fallback={
          <button
            class="flex w-full items-center gap-2 rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
            onClick={() => setAutomationComposerOpen(true, false)}
          >
            <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted">
              <RobotIcon class="size-3.5" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium text-ink">No automations yet</p>
              <p class="mt-0.5 text-xxs text-ink-muted">Create one</p>
            </div>
          </button>
        }
      >
        <div class="space-y-1">
          <For each={visibleAutomations()}>
            {(automation) => <AutomationSummary automation={automation} />}
          </For>
        </div>
      </Show>
    </aside>
  );
}

function DashboardAiInput() {
  const editor = buildChatEditor();

  const handleSend = async (request: ChatSendInput) => {
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) return;

    setPendingSendData({
      content: request.content,
      attachments: request.attachments,
      model: request.model,
    });

    globalSplitManager()?.openWithSplit(
      { type: 'chat', id: response.value.id },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: request.metaKey,
      }
    );
  };

  return (
    <ChatInputProvider>
      <ChatInput editor={editor} onSend={handleSend} isPersistent />
    </ChatInputProvider>
  );
}

export function Hero() {
  const user = useUserContext();
  const { openSettings } = useSettingsState();
  const [moreOpen, setMoreOpen] = createSignal(false);

  const firstName = createMemo(() => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  });

  const greeting = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  });

  return (
    <section class="@container/hero relative px-6 py-8 sm:px-8 sm:py-12">
      <HeroAutomationsPanel />

      <div class="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h1 class="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl lg:text-5xl">
          {greeting()}, <span class="capitalize">{firstName()}.</span>
        </h1>

        <div class="mt-6 w-full max-w-2xl text-left">
          <DashboardAiInput />
        </div>

        <div class="mt-5 flex flex-wrap justify-center gap-3">
          <Button
            variant="cta"
            size="lg"
            class="h-10 rounded-lg px-4 text-sm"
            onClick={() => setCreateMenuOpen(true)}
          >
            <PlusIcon />
            Create
          </Button>
          <Button
            variant="base"
            size="lg"
            class="h-10 rounded-lg px-4 text-sm"
            onClick={() => CommandState.open()}
          >
            <SearchIcon class="size-4" />
            Search
          </Button>
          <ResponsiveDropdown open={moreOpen()} onOpenChange={setMoreOpen}>
            <ResponsiveDropdown.Trigger
              class="inline-flex h-10 items-center gap-2 rounded-lg border border-edge-muted bg-transparent px-3 text-sm font-medium text-ink-muted transition hover:bg-hover hover:text-ink focus:outline-none focus-visible:bg-active"
              aria-label="More dashboard actions"
            >
              <MoreIcon class="size-4" />
              More
            </ResponsiveDropdown.Trigger>
            <ResponsiveDropdown.Portal>
              <ResponsiveDropdown.Content class="z-highlight-menu min-w-48 rounded-xl border border-edge bg-surface p-1.5 shadow-xl shadow-drop-shadow outline-none">
                <ResponsiveDropdown.Item
                  text="Invite teammate"
                  icon={UsersThreeIcon}
                  onClick={() => {
                    setInviteModalOpen(true);
                    setMoreOpen(false);
                  }}
                />
                <ResponsiveDropdown.Item
                  text="Create automation"
                  icon={RobotIcon}
                  onClick={() => {
                    setAutomationComposerOpen(true, false);
                    setMoreOpen(false);
                  }}
                />
                <ResponsiveDropdown.Item
                  text="Team settings"
                  icon={GearIcon}
                  onClick={() => {
                    openSettings('Team');
                    setMoreOpen(false);
                  }}
                />
                <ResponsiveDropdown.Item
                  text="View automations"
                  icon={RobotIcon}
                  onClick={() => {
                    openAutomationsView();
                    setMoreOpen(false);
                  }}
                />
              </ResponsiveDropdown.Content>
            </ResponsiveDropdown.Portal>
          </ResponsiveDropdown>
        </div>
      </div>
    </section>
  );
}
