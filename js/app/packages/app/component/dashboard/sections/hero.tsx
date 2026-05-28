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
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import MoreIcon from '@phosphor-icons/core/fill/dots-three-outline-fill.svg?component-solid';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { Button } from '@ui';
import { createMemo, createSignal } from 'solid-js';

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
    <section class="px-6 py-8 sm:px-8 sm:py-12">
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
