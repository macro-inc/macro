import { setInviteModalOpen } from "@app/component/app-sidebar/invite-modal";
import { CommandState } from "@app/component/command";
import { setCreateMenuOpen } from "@app/component/Launcher";
import { globalSplitManager } from "@app/signal/splitLayout";
import { buildChatEditor } from "@core/component/AI/component/input/buildChatEditor";
import type { ChatSendInput } from "@core/component/AI/component/input/buildRequest";
import { ChatInput } from "@core/component/AI/component/input/ChatInput";
import { ChatInputProvider } from "@core/component/AI/context";
import { setPendingSendData } from "@core/component/AI/signal/pendingSend";
import { setAutomationComposerOpen } from "@block-automation/component";
import { useSettingsState } from "@core/constant/SettingsState";
import GearIcon from "@phosphor/gear.svg";
import PlusIcon from "@phosphor/plus.svg";
import RobotIcon from "@phosphor/robot.svg";
import SearchIcon from "@phosphor/magnifying-glass.svg";
import UsersThreeIcon from "@phosphor/users-three.svg";
import MoreIcon from "@phosphor-icons/core/fill/dots-three-outline-fill.svg?component-solid";
import { cognitionApiServiceClient } from "@service-cognition/client";
import { Button, Dropdown } from "@ui";
import { createMemo, createSignal } from "solid-js";

import { useUserContext } from "@core/context/user";

function openAutomationsView() {
  globalSplitManager()?.openWithSplit(
    { type: "component", id: "agents" },
    {
      activate: true,
      referredFrom: "dashboard",
    },
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
      { type: "chat", id: response.value.id },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: request.metaKey,
      },
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
    return name.includes("@") ? name.split("@")[0] : name.split(" ")[0];
  });

  const greeting = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  });

  return (
    <section class="py-10 sm:py-14">
      <div class="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        <h1 class="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl lg:text-5xl">
          {greeting()}, <span class="capitalize">{firstName()}.</span>
        </h1>

        <div class="w-full max-w-2xl text-left">
          <DashboardAiInput />
        </div>

        <div class="flex flex-wrap justify-center gap-3">
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
          <Dropdown
            open={moreOpen()}
            onOpenChange={setMoreOpen}
            placement="bottom-end"
          >
            <Dropdown.Trigger
              variant="base"
              size="lg"
              class="h-10 rounded-lg px-3 text-sm"
              aria-label="More dashboard actions"
            >
              <MoreIcon class="size-4" />
              More
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-48">
              <Dropdown.Group>
                <Dropdown.Item onSelect={() => setInviteModalOpen(true)}>
                  <UsersThreeIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="flex-1 truncate text-ink-muted">
                    Invite teammate
                  </span>
                </Dropdown.Item>
                <Dropdown.Item
                  onSelect={() => setAutomationComposerOpen(true, false)}
                >
                  <RobotIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="flex-1 truncate text-ink-muted">
                    Create automation
                  </span>
                </Dropdown.Item>
                <Dropdown.Item onSelect={() => openSettings("Team")}>
                  <GearIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="flex-1 truncate text-ink-muted">
                    Team settings
                  </span>
                </Dropdown.Item>
                <Dropdown.Item onSelect={openAutomationsView}>
                  <RobotIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="flex-1 truncate text-ink-muted">
                    View automations
                  </span>
                </Dropdown.Item>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        </div>
      </div>
    </section>
  );
}
