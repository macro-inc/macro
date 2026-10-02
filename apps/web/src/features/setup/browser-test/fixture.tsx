import '@fontsource-variable/inter';
import '../../../index.css';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { OnboardingFlow } from '../flow/OnboardingFlow';
import { fixtureEvents } from './mocks';

render(
  () => (
    <>
      <div style={{ height: '100svh' }}>
        <OnboardingFlow />
      </div>
      <details class="fixed bottom-1 right-1 z-[2000] max-h-40 overflow-auto bg-surface text-ink text-xs">
        <summary>Test events (no real requests)</summary>
        <For each={fixtureEvents()}>{(event) => <p>{event}</p>}</For>
      </details>
    </>
  ),
  document.getElementById('root')!
);
