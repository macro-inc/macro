import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { IconButton } from '@core/component/IconButton';
import { runCommand } from '@core/hotkey/hotkeys';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import { Show } from 'solid-js';

const EntityNavigationIndicator = () => {
  const {
    unifiedListContext: {
      entitiesSignal: [entities],
      selectedView,
      viewsDataStore,
    },
    handle,
  } = useSplitPanelOrThrow();
  const selectedViewData = () => viewsDataStore[selectedView()];
  const selectedEntity = () => selectedViewData().selectedEntity;
  const selectedEntityIndex = () =>
    entities()?.findIndex((item) => item.id === selectedEntity()?.id) ?? -1;

  const getNavigationCommand = (key: 'j' | 'k') => {
    const currentActiveScope = activeScope();
    if (!currentActiveScope) return undefined;
    let activeScopeNode = hotkeyScopeTree.get(currentActiveScope);
    if (!activeScopeNode) return undefined;
    if (activeScopeNode?.type !== 'dom') return;
    const dom = activeScopeNode.element;
    const closestSplitScope = dom.closest('[data-hotkey-scope^="split"]');
    if (!closestSplitScope || !(closestSplitScope instanceof HTMLElement))
      return;
    const scopeId = closestSplitScope.dataset.hotkeyScope;
    if (!scopeId) return undefined;
    const splitNode = hotkeyScopeTree.get(scopeId);
    if (!splitNode) return undefined;
    return splitNode.hotkeyCommands.get(key);
  };

  return (
    <Show
      when={
        entities()?.length &&
        selectedEntity() &&
        handle.content().type !== 'component' &&
        handle.content().type !== 'project'
      }
    >
      <div class="flex gap-1 items-center font-mono text-xs text-ink/50 pl-2 pr-4">
        <div>
          [<span class="text-ink">{selectedEntityIndex() + 1}</span>/
          {entities()?.length}]
        </div>
        <div>{selectedViewData().view}</div>
        <div class="flex text-ink">
          <IconButton
            size="sm"
            icon={CaretDown}
            tooltip={{
              label: 'Navigate Down',
              hotkeyToken: TOKENS.entity.step.end,
            }}
            disabled={selectedEntityIndex() >= entities()!.length - 1}
            theme="current"
            onDeepClick={() => {
              const command = getNavigationCommand('j');
              if (!command) return;
              runCommand(command);
            }}
          />
          <IconButton
            size="sm"
            icon={CaretUp}
            tooltip={{
              label: 'Navigate Up',
              hotkeyToken: TOKENS.entity.step.start,
            }}
            disabled={selectedEntityIndex() === 0}
            theme="current"
            onDeepClick={() => {
              const command = getNavigationCommand('k');
              if (!command) return;
              runCommand(command);
            }}
          />
        </div>
      </div>
    </Show>
  );
};

export default EntityNavigationIndicator;
