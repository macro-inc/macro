import { t } from '@app/lib/i18n';
import RobotIcon from '@icon/system/regular/robot.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type { ToolSetting } from '../core/model';
import { stateLabel } from './labels';
import { PermissionStateGlyph } from './permission-state-glyph';

/**
 * Saved rules on single tools of one action. The settings never create
 * them (the agent restricting itself does, and older settings did); they
 * stay listed so they can be seen and removed.
 */
export function ToolSettingsList(props: {
  settings: ToolSetting[];
  editable: boolean;
  /** The setting's removal is saving. */
  removing: (setting: ToolSetting) => boolean;
  onRemove: (setting: ToolSetting) => void;
}) {
  return (
    <div class="flex flex-col pt-2">
      <p class="flex h-8 items-center text-[13px] font-medium text-ink">
        {t('agentPermissions.individualTools')}
      </p>
      <For each={props.settings}>
        {(setting) => (
          <div
            class="flex min-h-11 items-center gap-3"
            classList={{ 'opacity-50': props.removing(setting) }}
          >
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm text-ink">
                {setting.tool.label}
              </span>
              <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted">
                <span class="truncate">{setting.group.name}</span>
                <Show when={setting.rule.viaAgent}>
                  <span aria-hidden="true">·</span>
                  <span class="inline-flex shrink-0 items-center gap-1">
                    <RobotIcon aria-hidden="true" class="size-3" />
                    {t('agentPermissions.setByAgent')}
                  </span>
                </Show>
              </span>
            </div>
            <span class="inline-flex shrink-0 items-center gap-1.5 text-sm text-ink-muted">
              <PermissionStateGlyph state={setting.rule.state} />
              {stateLabel(setting.rule.state)}
            </span>
            <Show when={props.editable}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('agentPermissions.removeToolSetting', {
                  tool: setting.tool.label,
                })}
                tooltip={t('agentPermissions.removeToolSetting', {
                  tool: setting.tool.label,
                })}
                disabled={props.removing(setting)}
                onClick={() => props.onRemove(setting)}
              >
                <XIcon class="size-3.5 shrink-0 pointer-events-none" />
              </Button>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
