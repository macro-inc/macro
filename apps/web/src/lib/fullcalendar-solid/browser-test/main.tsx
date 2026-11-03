import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../features/theme/themes/macro-dark';
import { macroLightTheme } from '../../../features/theme/themes/macro-light';
import { FullCalendar } from '../FullCalendar';
import '../../../index.css';
import '../../../features/calendar/calendar.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(
  params.get('theme') === 'light'
);
const theme =
  params.get('theme') === 'light' ? macroLightTheme : macroDarkTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
const calls: { method: string; hidden: boolean }[] = [];
const updateSize = Calendar.prototype.updateSize;
Calendar.prototype.updateSize = function () {
  calls.push({
    method: 'updateSize',
    hidden: !this.el.clientWidth || !this.el.clientHeight,
  });
  return updateSize.call(this);
};
// Instrument the actual library boundary, without changing connector behavior.
const resetOptions = Calendar.prototype.resetOptions;
Calendar.prototype.resetOptions = function (...args) {
  calls.push({
    method: 'resetOptions',
    hidden: !this.el.clientWidth || !this.el.clientHeight,
  });
  return resetOptions.apply(this, args);
};

function Fixture() {
  const [hidden, setHidden] = createSignal(false);
  const [mounted, setMounted] = createSignal(true);
  const [height, setHeight] = createSignal(600);
  const [weekends, setWeekends] = createSignal(true);
  return (
    <main class="min-h-screen bg-page p-6 text-ink">
      <nav class="mb-4 flex gap-4">
        <button onClick={() => setHidden(!hidden())}>Toggle hidden</button>
        <button onClick={() => setMounted(!mounted())}>Toggle mounted</button>
        <button onClick={() => setHeight(height() === 600 ? 400 : 600)}>
          Resize height
        </button>
        <button onClick={() => setWeekends(!weekends())}>
          Toggle weekends
        </button>
        <button
          onClick={() => {
            calls.length = 0;
          }}
        >
          Clear calls
        </button>
      </nav>
      <output data-calls>{JSON.stringify(calls)}</output>
      <div
        data-calendar-container
        class="calendar-view"
        style={{
          display: hidden() ? 'none' : undefined,
          height: `${height()}px`,
          width: '900px',
        }}
      >
        <Show when={mounted()}>
          <FullCalendar.Root
            plugins={[dayGridPlugin]}
            initialDate="2025-01-15"
            now="2025-01-15"
            initialView="dayGridMonth"
            height="100%"
            headerToolbar={false}
            handleWindowResize={false}
            weekends={weekends()}
            events={[
              { id: 'planning', title: 'Planning', start: '2025-01-15' },
            ]}
          >
            <FullCalendar.EventContent>
              {(arg) => <span>{arg.event.title}</span>}
            </FullCalendar.EventContent>
            <FullCalendar.Host class="size-full" />
          </FullCalendar.Root>
        </Show>
      </div>
    </main>
  );
}

// Browser tests read the bounded capture through a DOM event, not a production API.
document.addEventListener('calendar-calls', () => {
  document.querySelector('[data-calls]')!.textContent = JSON.stringify(calls);
});
render(() => <Fixture />, document.getElementById('root')!);
