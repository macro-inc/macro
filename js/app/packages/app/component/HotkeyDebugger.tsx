import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import type { HotkeyCommand, ValidHotkey } from '@core/hotkey/types';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { SplitHeaderLeft } from './split-layout/components/SplitHeader';
import { StaticSplitLabel } from './split-layout/components/SplitLabel';

type DebugCommand = HotkeyCommand & {
  scopeLevel: number;
  hotkeyIsShadowed: boolean;
  isHidden: boolean;
};

function describe(command: HotkeyCommand): string {
  return typeof command.description === 'function'
    ? command.description()
    : command.description;
}

function isCommandHidden(command: HotkeyCommand): boolean {
  return typeof command.hide === 'function' ? command.hide() : !!command.hide;
}

export default function HotkeyDebugger() {
  const commands = createMemo<DebugCommand[]>(() => {
    const active = activeScope();
    const hotkeySet = new Set<ValidHotkey>();
    const out: DebugCommand[] = [];
    let current = hotkeyScopeTree.get(active);
    let scopeLevel = 0;
    while (current) {
      const scopeCommands = [
        ...Array.from(current.hotkeyCommands.values()).flat(),
        ...current.unkeyedCommands,
      ];
      for (const command of scopeCommands) {
        const hotkeys = command.hotkeys ?? [];
        const hotkeyIsShadowed = hotkeys.some((hk) => hotkeySet.has(hk));
        for (const hk of hotkeys) hotkeySet.add(hk);
        out.push({
          ...command,
          scopeLevel,
          hotkeyIsShadowed,
          isHidden: isCommandHidden(command),
        });
      }
      if (!current.parentScopeId) break;
      current = hotkeyScopeTree.get(current.parentScopeId);
      scopeLevel++;
    }
    return out;
  });

  const scopeChain = createMemo(() => {
    const active = activeScope();
    const chain: { scopeId: string; type: string; level: number }[] = [];
    let current = hotkeyScopeTree.get(active);
    let level = 0;
    while (current) {
      chain.push({
        scopeId: current.scopeId,
        type: current.type,
        level,
      });
      if (!current.parentScopeId) break;
      current = hotkeyScopeTree.get(current.parentScopeId);
      level++;
    }
    return chain;
  });

  return (
    <div class="flex h-full w-full flex-col overflow-hidden bg-dialog font-mono text-xs text-ink">
      <SplitHeaderLeft>
        <StaticSplitLabel label="Hotkey Debugger" />
      </SplitHeaderLeft>
      <div class="flex flex-col gap-2 border-b border-edge bg-panel px-4 py-3">
        <div class="flex items-baseline gap-2">
          <span class="text-ink-muted">
            active scope:{' '}
            <span class="font-semibold text-ink">{activeScope()}</span>
          </span>
          <span class="ml-auto text-ink-muted">
            {commands().length} commands
          </span>
        </div>
        <div class="flex flex-wrap gap-1">
          <For each={scopeChain()}>
            {(scope, index) => (
              <>
                <Show when={index() > 0}>
                  <span class="text-ink-extra-muted">→</span>
                </Show>
                <span
                  class={cn(
                    'rounded border px-1.5 py-0.5',
                    index() === 0
                      ? 'border-accent text-accent'
                      : 'border-edge-muted text-ink-muted'
                  )}
                  title={`${scope.type} scope · level ${scope.level}`}
                >
                  {scope.scopeId}
                  <span class="ml-1 text-ink-extra-muted">({scope.type})</span>
                </span>
              </>
            )}
          </For>
        </div>
      </div>

      <div class="flex-1 overflow-auto">
        <table class="w-full border-collapse">
          <thead class="sticky top-0 z-10 bg-panel">
            <tr class="text-left text-xxs uppercase tracking-wide text-ink-muted">
              <th class="border-b border-edge px-3 py-2 font-normal">Lvl</th>
              <th class="border-b border-edge px-3 py-2 font-normal">Scope</th>
              <th class="border-b border-edge px-3 py-2 font-normal">
                Description
              </th>
              <th class="border-b border-edge px-3 py-2 font-normal">Hotkey</th>
              <th class="border-b border-edge px-3 py-2 font-normal">Token</th>
              <th class="border-b border-edge px-3 py-2 font-normal">Flags</th>
            </tr>
          </thead>
          <tbody>
            <For each={commands()}>
              {(command) => {
                const hotkey = () =>
                  (command.hotkeys ?? [])
                    .map(prettyPrintHotkeyString)
                    .join(', ');
                return (
                  <tr
                    class={cn(
                      'border-b border-edge-muted align-top hover:bg-hover',
                      (command.hotkeyIsShadowed || command.isHidden) &&
                        'text-ink-extra-muted'
                    )}
                  >
                    <td class="px-3 py-1 text-ink-muted">
                      {command.scopeLevel}
                    </td>
                    <td class="px-3 py-1 text-ink-muted">{command.scopeId}</td>
                    <td
                      class={cn(
                        'px-3 py-1',
                        command.isHidden ? 'text-ink-muted italic' : 'text-ink'
                      )}
                    >
                      {describe(command)}
                    </td>
                    <td class="px-3 py-1">
                      <Show
                        when={hotkey()}
                        fallback={<span class="text-ink-extra-muted">—</span>}
                      >
                        <span
                          class={cn(
                            command.hotkeyIsShadowed
                              ? 'text-failure line-through'
                              : 'text-accent'
                          )}
                          title={
                            command.hotkeyIsShadowed
                              ? 'Shadowed by a command in a more specific scope'
                              : undefined
                          }
                        >
                          {hotkey()}
                        </span>
                      </Show>
                    </td>
                    <td class="px-3 py-1 text-ink-muted">
                      {command.hotkeyToken ?? (
                        <span class="text-ink-extra-muted">—</span>
                      )}
                    </td>
                    <td class="px-3 py-1">
                      <div class="flex gap-1">
                        <Show when={command.isHidden}>
                          <span
                            class="rounded border border-edge-muted px-1 text-ink-muted"
                            title="hide === true — not shown in command menu / hotkey UI"
                          >
                            hidden
                          </span>
                        </Show>
                        <Show when={command.hotkeyIsShadowed}>
                          <span
                            class="rounded border border-failure px-1 text-failure"
                            title="Shadowed by a command with the same hotkey in a more specific scope"
                          >
                            shadowed
                          </span>
                        </Show>
                      </div>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}
