import { ResponsiveDropdown } from '@app/component/SimpleDropdown';
import { TabsInset } from '@core/component/TabsInset';
import ChatCircleTextIcon from '@phosphor/chat-circle-text.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import PlusIcon from '@phosphor/plus.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import MoreIcon from '@phosphor-icons/core/fill/dots-three-outline-fill.svg?component-solid';
import { AnimatedStarIcon } from '@icon/wide-star';
import { Button } from '@ui';
import { createMemo, createSignal } from 'solid-js';

import { useUserContext } from '@core/context/user';

export function Hero() {
  const user = useUserContext();
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [aiHovering, setAiHovering] = createSignal(false);

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
    <section class="px-6 py-8 sm:px-8 sm:py-10">
      <div class="max-w-3xl">
        <TabsInset
          class="mb-5 inline-flex h-auto"
          defaultValue="team"
          list={[
            { value: 'team', label: 'Team' },
            { value: 'individual', label: 'Individual' },
          ]}
        />

        <h1 class="text-3xl font-semibold tracking-tight text-ink text-balance sm:text-4xl lg:text-5xl">
          {greeting()}, <span class="capitalize">{firstName()}.</span>
        </h1>
        <div class="mt-6 flex flex-wrap gap-3">
          <Button variant="cta" size="lg" class="h-10 rounded-lg px-4 text-sm">
            <PlusIcon />
            Create
          </Button>
          <Button
            variant="base"
            size="lg"
            class="h-10 rounded-lg px-4 text-sm"
            onPointerEnter={() => setAiHovering(true)}
            onPointerLeave={() => setAiHovering(false)}
          >
            <AnimatedStarIcon class="size-4" triggerAnimation={aiHovering()} />
            Ask AI
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
                  text="Compose email"
                  icon={EnvelopeSimpleIcon}
                />
                <ResponsiveDropdown.Item
                  text="Create task"
                  icon={ListChecksIcon}
                />
                <ResponsiveDropdown.Item
                  text="Start channel"
                  icon={ChatCircleTextIcon}
                />
                <ResponsiveDropdown.Item
                  text="Invite teammate"
                  icon={UsersThreeIcon}
                />
              </ResponsiveDropdown.Content>
            </ResponsiveDropdown.Portal>
          </ResponsiveDropdown>
        </div>
      </div>
    </section>
  );
}
