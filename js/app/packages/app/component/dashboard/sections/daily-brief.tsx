import ArrowRightIcon from '@phosphor/arrow-right.svg';
import ChatCircleTextIcon from '@phosphor/chat-circle-text.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import { AnimatedStarIcon } from '@icon/wide-star';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

export function DailyBriefSection() {
  const [hovering, setHovering] = createSignal(false);

  return (
    <section class="px-6 pb-8 sm:px-8">
      <div class="max-w-3xl">
        <div class="relative overflow-hidden rounded-2xl border border-edge-muted bg-ink p-5 text-surface shadow-sm sm:p-6">
          <div class="absolute -right-24 -top-24 size-64 rounded-full bg-accent/30 blur-3xl" />
          <div class="absolute -bottom-24 left-1/4 size-56 rounded-full bg-surface/10 blur-3xl" />
          <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_46%)]" />

          <div class="relative grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div class="mb-5 flex size-10 items-center justify-center rounded-xl border border-surface/10 bg-surface/10 text-accent backdrop-blur">
                <AnimatedStarIcon class="size-5" triggerAnimation={hovering()} />
              </div>
              <p class="text-xs font-medium uppercase tracking-[0.18em] text-surface/50">
                Ask Macro
              </p>
              <h2 class="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                What should I focus on next?
              </h2>

              <div class="mt-5 flex flex-wrap gap-2 text-xs font-medium text-surface/70">
                <span class="inline-flex items-center gap-1.5 rounded-full border border-surface/10 bg-surface/10 px-2.5 py-1 backdrop-blur">
                  <ListChecksIcon class="size-3.5" />
                  Prioritize work
                </span>
                <span class="inline-flex items-center gap-1.5 rounded-full border border-surface/10 bg-surface/10 px-2.5 py-1 backdrop-blur">
                  <ChatCircleTextIcon class="size-3.5" />
                  Draft replies
                </span>
              </div>
            </div>

            <Button
              variant="cta"
              size="lg"
              class="h-10 rounded-lg px-4 text-sm"
              onPointerEnter={() => setHovering(true)}
              onPointerLeave={() => setHovering(false)}
            >
              Start
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
