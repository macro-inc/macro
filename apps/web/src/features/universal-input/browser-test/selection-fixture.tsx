import { attachGlobalDOMScope, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { For, Show } from 'solid-js';
import { SelectionOffer } from '../selection-offer';
import { commandSubmissions } from './fixture';
import '@fontsource-variable/inter';
import '../../../index.css';

const PASSAGES = [
  {
    id: 'channel-passage',
    surface: 'channel-message',
    label: 'Channel message',
    text: 'let us meet for coffee at 8am tomorrow before the standup',
  },
  {
    id: 'email-passage',
    surface: 'email-message',
    label: 'Email message',
    text: 'ship the onboarding checklist before the release on Thursday',
    shadow: true,
  },
  {
    id: 'question-passage',
    surface: 'document',
    label: 'Document',
    text: 'how does the billing pipeline decide proration for upgrades?',
  },
  {
    id: 'short-passage',
    surface: 'channel-message',
    label: 'Short message',
    text: 'see you',
  },
];

/** The email renderer mounts its body in a shadow root; selections there read
 *  back as nodes inside it, which `closest()` cannot climb out of. */
function mountShadowBody(host: HTMLElement, id: string, text: string) {
  const body = host.attachShadow({ mode: 'open' });
  const content = document.createElement('div');
  content.style.userSelect = 'text';
  content.innerHTML = `<p data-testid="${id}"><span>${text}</span></p>`;
  body.append(content);
}

/** Opted-in surfaces around the real offer, with no network of its own. */
export function SelectionOfferFixture() {
  useHotKeyRoot();
  attachGlobalDOMScope(document.body);
  return (
    // The top inset leaves the chip room to sit above the first passage.
    <main class="min-h-screen space-y-8 bg-page p-12 pt-32 text-ink">
      <For each={PASSAGES}>
        {(passage) => (
          <section class="max-w-150 space-y-1">
            <h2 class="font-medium text-ink-muted text-xs">{passage.label}</h2>
            <div data-selection-offer={passage.surface}>
              <Show
                when={passage.shadow}
                fallback={
                  // Rendered Markdown wraps its text in spans, which is what
                  // the app's default `user-select: none` makes selectable.
                  <p data-testid={passage.id}>
                    <span>{passage.text}</span>
                  </p>
                }
              >
                <div
                  ref={(element) =>
                    mountShadowBody(element, passage.id, passage.text)
                  }
                />
              </Show>
            </div>
          </section>
        )}
      </For>
      <section class="max-w-150 space-y-1">
        <h2 class="font-medium text-ink-muted text-xs">
          Surface that did not opt in
        </h2>
        <p data-testid="unmarked-passage">
          <span>let us meet for coffee at 8am tomorrow somewhere unmarked</span>
        </p>
      </section>
      <SelectionOffer />
      <output hidden data-testid="selection-submission-count">
        {commandSubmissions().length}
      </output>
      <output hidden data-testid="last-selection-submission">
        {JSON.stringify(commandSubmissions().at(-1))}
      </output>
    </main>
  );
}
