import type { SplitId } from '@components/app/split-layout/layoutManager';
import type { MobilePaneStack } from '@components/app/split-layout/mobile/createMobilePaneStack';
import { createMobileSplitMotion } from '@components/app/split-layout/mobile/createMobileSplitMotion';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../features/theme/themes/macro-dark';
import { macroLightTheme } from '../../../features/theme/themes/macro-light';
import { FullCalendar } from '../FullCalendar';
import '../../../index.css';
import '../../../features/calendar/calendar.css';

const params = new URLSearchParams(location.search);
const theme =
  params.get('theme') === 'light' ? macroLightTheme : macroDarkTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = String(theme.mode === 'light');
const calls: { hidden: boolean }[] = [];
const updateSize = Calendar.prototype.updateSize;
Calendar.prototype.updateSize = function () {
  calls.push({
    hidden:
      getComputedStyle(this.el).visibility === 'hidden' || !this.el.clientWidth,
  });
  return updateSize.call(this);
};

function Fixture() {
  const calendarId = 'fixture-calendar' as SplitId;
  const frontId = 'fixture-front' as SplitId;
  const [covered, setCovered] = createSignal(true);
  let animatedTrigger: (() => void) | undefined;
  let forwardTrigger: ((from: SplitId) => void) | undefined;
  const stack: MobilePaneStack = {
    front: () => (covered() ? frontId : calendarId),
    behind: () => (covered() ? calendarId : undefined),
    canGoBack: covered,
    completeGoBack: () => setCovered(false),
    goBack: () => animatedTrigger?.(),
    setAnimatedTrigger: (trigger) => {
      animatedTrigger = trigger;
    },
    setForwardTrigger: (trigger) => {
      forwardTrigger = trigger;
    },
  };
  const motion = createMobileSplitMotion({ stack });
  const [weekends, setWeekends] = createSignal(true);
  return (
    <main class="bg-page text-ink">
      <nav class="flex gap-4 p-2">
        <button
          onClick={() =>
            batch(() => {
              setCovered(true);
              forwardTrigger?.(calendarId);
            })
          }
        >
          Cover
        </button>
        <button onClick={stack.goBack}>Back</button>
        <button onClick={() => setWeekends(!weekends())}>Weekends</button>
        <button
          onClick={() => {
            calls.length = 0;
          }}
        >
          Clear
        </button>
      </nav>
      <output data-calls />
      <div
        data-stack
        class="relative h-[600px] w-full overflow-hidden"
        on:touchstart={motion.handleTouchStart}
        on:touchmove={motion.handleTouchMove}
        on:touchend={motion.handleTouchEnd}
        on:touchcancel={motion.handleTouchCancel}
      >
        <div
          data-calendar-pane
          class={motion.classFor(!covered())}
          style={motion.styleFor(!covered())}
          onTransitionEnd={(event) =>
            motion.handleTransitionEnd(event, !covered())
          }
        >
          <div class="calendar-view size-full">
            <FullCalendar.Root
              plugins={[dayGridPlugin]}
              initialDate="2025-01-15"
              now="2025-01-15"
              initialView="dayGridMonth"
              height="100%"
              headerToolbar={false}
              handleWindowResize={false}
              weekends={weekends()}
            >
              <FullCalendar.Host class="size-full" />
            </FullCalendar.Root>
          </div>
        </div>
        <div
          data-front-pane
          class={motion.classFor(covered())}
          style={motion.styleFor(covered())}
          onTransitionEnd={(event) =>
            motion.handleTransitionEnd(event, covered())
          }
        >
          <div class="size-full bg-panel p-6">Front pane</div>
        </div>
      </div>
    </main>
  );
}
document.addEventListener('calendar-calls', () => {
  document.querySelector('[data-calls]')!.textContent = JSON.stringify(calls);
});
render(() => <Fixture />, document.getElementById('root')!);
