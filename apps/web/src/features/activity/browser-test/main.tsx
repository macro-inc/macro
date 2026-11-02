import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import '../../../index.css';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { ActionGraph } from '../components/action-graph';
import type { ActivityOverview } from '../core/event';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const overview: ActivityOverview = {
  from: '2024-01-02',
  to: '2025-01-01',
  timeZone: 'UTC',
  total: 10,
  days: [
    { date: '2024-01-02', count: 1 },
    { date: '2024-12-31', count: 9 },
  ],
  topEntities: [],
};

function Fixture() {
  const [mounted, setMounted] = createSignal(true);
  const [skeleton, setSkeleton] = createSignal(false);
  const [current, setCurrent] = createSignal(overview);
  return (
    <main class="mx-auto max-w-5xl p-6">
      <button onClick={() => setMounted((value) => !value)}>
        Toggle graph
      </button>
      <button onClick={() => setSkeleton((value) => !value)}>
        Toggle skeleton
      </button>
      <button
        onClick={() =>
          setCurrent({
            ...overview,
            total: 11,
            days: [{ date: '2024-12-31', count: 11 }],
          })
        }
      >
        Update counts
      </button>
      <Show when={mounted()}>
        <ActionGraph overview={current()} skeleton={skeleton()} />
      </Show>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
