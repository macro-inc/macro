import { Hotkey } from '@core/component/Hotkey';
import { useHotkeyCommandByToken } from '@core/hotkey/hotkeys';
import { executedTokens } from '@core/hotkey/state';
import type { HotkeyToken } from '@core/hotkey/tokens';
import ArrowRight from '@icon/regular/arrow-right.svg';
import { createMemo, For, Show } from 'solid-js';

export interface HotkeyExampleProps {
  hotkeyTokenSequence: HotkeyToken[];
  subtitle?: string;
}

export function HotkeyExample(props: HotkeyExampleProps) {
  const commandSequence = props.hotkeyTokenSequence.map((token) => ({
    command: useHotkeyCommandByToken(token),
    executed: createMemo(() => executedTokens().includes(token)),
  }));

  const lowerCaseFirstChar = (str: string) =>
    str.charAt(0).toLowerCase() + str.slice(1);

  const lastCommandDescription_ = commandSequence
    .at(-1)
    ?.command()?.description;
  const lastCommandDescription = createMemo(() =>
    lowerCaseFirstChar(
      typeof lastCommandDescription_ === 'function'
        ? lastCommandDescription_()
        : (lastCommandDescription_ ?? '')
    )
  );

  return (
    <div class="h-min hotkey-list col-span-full grid grid-cols-subgrid">
      <div class="hotkey-item col-span-full grid grid-cols-subgrid">
        <div class="hotkeys col-span-1 flex items-center gap-2">
          <For each={commandSequence}>
            {(item, index) => (
              <>
                <Show when={item.command()}>
                  {(command) => (
                    <Hotkey
                      token={command().hotkeyToken}
                      showPlus
                      class="font-mono text-base h-9 min-w-9 px-3 flex items-center justify-center gap-2 border transition-all duration-300"
                      classList={{
                        "border-accent/75 bg-accent/75 text-panel [font-variation-settings:'wght'_600]":
                          item.executed(),
                        "bg-input border-edge-muted text-accent/75 [font-variation-settings:'wght'_400]":
                          !item.executed(),
                      }}
                    />
                  )}
                </Show>
                <Show when={index() < commandSequence.length - 1}>
                  <ArrowRight class="size-6 text-ink-muted shrink-0" />
                </Show>
              </>
            )}
          </For>
        </div>
        <div class="label col-start-2 flex flex-col justify-center">
          <h2 class="text-base">{lastCommandDescription()}</h2>
          {/* <p class="text-sm text-ink-muted">{props.subtitle}</p> */}
        </div>
      </div>
    </div>
  );
}
