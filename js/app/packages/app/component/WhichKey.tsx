import { useSubscribeToKeypress } from '@app/signal/hotkeyRoot';
import { Hotkey } from '@core/component/Hotkey';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { HotkeyCommand } from '@core/hotkey/types';
import {
  getHotkeyCommandByToken,
  prettyPrintHotkeyString,
} from '@core/hotkey/utils';
import {
  type Accessor,
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

export const [openWhichKey, setOpenWhichKey] = createSignal(false);

type WhichKeyContentProps = {
  commandsWithActivateScope: Accessor<HotkeyCommand[]>;
  commandsWithoutActivateScope: Accessor<HotkeyCommand[]>;
};

const WhichKeyContent: Component<WhichKeyContentProps> = (props) => {
  return (
    <Portal>
      <div class="absolute z-9999 right-2 bottom-[49px]">
        <div class="absolute -z-1 top-2 right-2 pattern-edge pattern-diagonal-4 opacity-100 w-full h-full mask-l-from-[calc(100%_-_1rem)] mask-b-from-[calc(100%_-_1rem)]" />
        <div class="px-8 py-4 w-full h-full bg-dialog border-2 border-accent text-sm">
          <Show when={props.commandsWithActivateScope().length > 0}>
            <div class="mb-4">
              <For each={props.commandsWithActivateScope()}>
                {(command) => (
                  <div class="grid grid-cols-[8ch_1fr] gap-2">
                    <Hotkey
                      class="font-mono font-medium"
                      token={command.hotkeyToken}
                      shortcut={prettyPrintHotkeyString(
                        // Asserting this, because useActiveCommands only returns commands with hotkeys.
                        command.hotkeys!.at(0)!
                      )}
                    />
                    <div>
                      {typeof command.description === 'function'
                        ? command.description()
                        : command.description}{' '}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <For each={props.commandsWithoutActivateScope()}>
            {(command) => (
              <div class="grid grid-cols-[8ch_1fr] gap-2">
                <Hotkey
                  class="font-mono font-medium"
                  token={command.hotkeyToken}
                  shortcut={prettyPrintHotkeyString(
                    // Asserting this, because useActiveCommands only returns commands with hotkeys.
                    command.hotkeys!.at(0)!
                  )}
                />
                <div>
                  {typeof command.description === 'function'
                    ? command.description()
                    : command.description}{' '}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Portal>
  );
};

export function WhichKey() {
  useSubscribeToKeypress((context) => {
    if (
      context.eventType === 'keydown' &&
      context.isNonModifierKeypress &&
      !context.commandScopeActivated &&
      !getHotkeyCommandByToken(TOKENS.global.toggleVisor)?.hotkeys?.some(
        (hotkey) => context.pressedKeysString === hotkey
      )
    ) {
      setOpenWhichKey(false);
    }
  });

  const isInCommandScope = createMemo(() => {
    const currentScopeId = activeScope();
    if (!currentScopeId) return false;
    const scopeNode = hotkeyScopeTree.get(currentScopeId);
    return scopeNode?.type === 'command';
  });

  const activeCommands = createMemo(() => {
    const currentScopeId = activeScope() ?? '';
    return getActiveCommandsFromScope(currentScopeId, {
      hideCommandsWithoutHotkeys: true,
      limitToCurrentScope: isInCommandScope(),
    });
  });

  const commandsWithActivateScope = createMemo(() => {
    return activeCommands().filter((command) => command.activateCommandScopeId);
  });

  const commandsWithoutActivateScope = createMemo(() => {
    return activeCommands().filter(
      (command) => !command.activateCommandScopeId
    );
  });

  // If user clicks anywhere, exit
  onMount(() => {
    const handleMousedown = () => {
      setOpenWhichKey(false);
    };
    document.addEventListener('mousedown', handleMousedown);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleMousedown);
    });
  });

  return (
    <Show when={openWhichKey()}>
      <WhichKeyContent
        commandsWithActivateScope={commandsWithActivateScope}
        commandsWithoutActivateScope={commandsWithoutActivateScope}
      />
    </Show>
  );
}
