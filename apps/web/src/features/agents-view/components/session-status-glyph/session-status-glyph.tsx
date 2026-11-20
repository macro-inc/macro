import { WorkingDots } from '@app/features/block-agent/ui/WorkingDots';
import { For, Match, Show, Switch } from 'solid-js';
import { Transition } from 'solid-transition-group';
import type { SessionStatus } from '../../core/session-status';
import './session-status-glyph.css';

const RING_CELLS = [0, 1, 2, 5, 8, 7, 6, 3];
const FAILED_CELLS = [0, 2, 4, 6, 8];

/** The shared 13px status face; descriptions belong to the row, not its dots. */
export function SessionStatusGlyph(props: { state: SessionStatus }) {
  return (
    <span
      class="session-status-glyph relative flex size-[13px] shrink-0 items-center justify-center"
      data-state={props.state}
      aria-hidden="true"
    >
      <Transition
        enterActiveClass="transition-opacity duration-150 ease-in-out"
        enterClass="opacity-0"
        enterToClass="opacity-100"
        exitActiveClass="transition-opacity duration-150 ease-in-out"
        exitClass="opacity-100"
        exitToClass="opacity-0"
      >
        <Show when={props.state} keyed>
          {(state) => (
            <span class="absolute inset-0 flex items-center justify-center">
              <Switch>
                <Match when={state === 'working'}>
                  <WorkingDots />
                </Match>
                <Match when={state === 'idle'}>
                  <span class="size-2 rounded-full border-[1.5px] border-ink/20" />
                </Match>
                <Match when={state === 'unread'}>
                  <span class="size-2 rounded-full bg-accent" />
                </Match>
                <Match when={state === 'failed'}>
                  <span class="relative size-[13px] text-failure">
                    <For each={FAILED_CELLS}>
                      {(cell) => (
                        <span
                          class="absolute size-[3px] rounded-full bg-current"
                          style={{
                            left: `${(cell % 3) * 5}px`,
                            top: `${Math.floor(cell / 3) * 5}px`,
                          }}
                        />
                      )}
                    </For>
                  </span>
                </Match>
                <Match when={state === 'waiting'}>
                  <span class="relative size-[13px] text-warning">
                    <For each={RING_CELLS}>
                      {(cell, index) => (
                        <span
                          class="session-waiting-dot absolute size-[3px] rounded-full bg-current"
                          style={{
                            left: `${(cell % 3) * 5}px`,
                            top: `${Math.floor(cell / 3) * 5}px`,
                            'animation-delay': `${index() * 162.5 - 1300}ms`,
                          }}
                        />
                      )}
                    </For>
                  </span>
                </Match>
              </Switch>
            </span>
          )}
        </Show>
      </Transition>
    </span>
  );
}
