import { useSoup } from '@app/component/next-soup/soup-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken, runCommand } from '@core/hotkey/utils';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import { Show } from 'solid-js';

const EntityNavigationIndicator = () => {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();
  const selectedEntity = () => soup.focus.item();
  const selectedEntityIndex = () => soup.focus.index();

  return (
    <Show
      when={
        panel.handle.referredFrom() === 'unified-list' &&
        soup.data()?.length &&
        selectedEntity() &&
        panel.handle.content().type !== 'component' &&
        panel.handle.content().type !== 'project'
      }
    >
      <div class="flex gap-1 items-center font-mono text-xs text-ink/50">
        <div>
          [<span class="text-ink">{selectedEntityIndex() + 1}</span>/
          {soup.data()?.length}]
        </div>
        <div class="flex text-ink">
          <DeprecatedIconButton
            size="sm"
            icon={CaretDown}
            tooltip={{
              label: 'Navigate Down',
              hotkeyToken: TOKENS.entity.step.end,
            }}
            disabled={selectedEntityIndex() >= soup.data()!.length - 1}
            theme="current"
            onDeepClick={() => {
              const command = getActiveCommandByToken(TOKENS.entity.step.end);
              if (!command) return;
              runCommand(command);
            }}
          />
          <DeprecatedIconButton
            size="sm"
            icon={CaretUp}
            tooltip={{
              label: 'Navigate Up',
              hotkeyToken: TOKENS.entity.step.start,
            }}
            disabled={selectedEntityIndex() === 0}
            theme="current"
            onDeepClick={() => {
              const command = getActiveCommandByToken(TOKENS.entity.step.start);
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
