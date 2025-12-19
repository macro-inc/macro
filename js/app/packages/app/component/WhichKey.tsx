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

function WhichKeyContent(props: WhichKeyContentProps) {
  return (
    <Show
      when={
        props.commandsWithActivateScope().length > 0 ||
        props.commandsWithoutActivateScope().length > 0
      }
    >
      <Portal>
        <div class="absolute z-9999 right-2 bottom-14">
          {/* <dfiv class="absolute -z-1 top-2 right-2 pattern-edge pattern-diagonal-4 opacity-100 w-full h-full mask-l-from-[calc(100%_-_1rem)] mask-b-from-[calc(100%_-_1rem)]" /> */}
          <div class="w-[280px] px-6 py-3 h-full bg-dialog/75 backdrop-blur-sm border-2 border-accent text-sm shadow-[0_0_2px_0_var(--color-accent)]">
            <Show when={props.commandsWithActivateScope().length > 0}>
              <div class="mb-6">
                <For each={props.commandsWithActivateScope()}>
                  {(command) => (
                    <div class="grid grid-cols-[8ch_1fr] gap-x-2 mb-1">
                      <div class="justify-self-start bg-panel border border-edge px-1.5 py-0.25 rounded-xs">
                        <Hotkey
                          token={command.hotkeyToken}
                          shortcut={prettyPrintHotkeyString(
                            // Asserting this, because useActiveCommands only returns commands with hotkeys.
                            command.hotkeys!.at(0)!
                          )}
                        />
                      </div>
                      <div class="truncate min-w-0">
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
                <div class="grid grid-cols-[8ch_1fr] gap-2 mb-1">
                  <div class="justify-self-start bg-panel border border-edge px-1.5 py-0.25 rounded-xs">
                    <Hotkey
                      token={command.hotkeyToken}
                      shortcut={prettyPrintHotkeyString(
                        // Asserting this, because useActiveCommands only returns commands with hotkeys.
                        command.hotkeys!.at(0)!
                      )}
                    />
                  </div>
                  <div class="truncate min-w-0">
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
    </Show>
  );
}

export function WhichKey() {
  useSubscribeToKeypress((context) => {
    if (
      context.eventType === 'keydown' &&
      context.isNonModifierKeypress &&
      (!context.commandScopeActivated ||
        context.commandCaptured?.hotkeyToken === TOKENS.global.createCommand) &&
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
      hideShadowedCommands: true,
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
