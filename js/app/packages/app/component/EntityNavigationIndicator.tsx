import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { IconButton } from '@core/component/IconButton';
import { runCommandByToken } from '@core/hotkey/hotkeys';
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
  } = useSplitPanelOrThrow();
  const selectedViewData = () => viewsDataStore[selectedView()];
  const selectedEntity = () => selectedViewData().selectedEntity;
  const selectedEntityIndex = () =>
    entities()?.findIndex((item) => item.id === selectedEntity()?.id) ?? -1;
  return (
    <Show when={entities()?.length && selectedEntity()}>
      <div class="flex gap-1 items-center font-mono text-sm text-ink/50 pl-2 pr-4">
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
            onClick={() => runCommandByToken(TOKENS.entity.step.end)}
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
            onClick={() => runCommandByToken(TOKENS.entity.step.start)}
          />
        </div>
      </div>
    </Show>
  );
};

export default EntityNavigationIndicator;
