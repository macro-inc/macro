import { Panel, ToggleSwitch } from '@ui';
import { Show } from 'solid-js';

export function ChannelTeamSettingsPanel(props: {
  isTeamChannel: boolean;
  autoJoinTeam: boolean;
  canConvertToTeam: boolean;
  conversionUnavailableReason?: string;
  disabled: boolean;
  onConvertToTeam: () => void;
  onAutoJoinTeamChange: (enabled: boolean) => void;
}) {
  return (
    <Panel depth={2} class="shrink-0 text-ink">
      <Panel.Header class="px-6">
        <div class="text-sm font-semibold">Team access</div>
      </Panel.Header>
      <Panel.Body>
        <div class="divide-y divide-edge-muted px-6">
          <div class="flex items-center justify-between gap-4 py-3">
            <div class="min-w-0">
              <div class="text-sm font-medium">Team channel</div>
              <p class="text-xs text-ink-muted">
                {props.isTeamChannel
                  ? 'This channel belongs to your team.'
                  : (props.conversionUnavailableReason ??
                    'Convert this channel into a team channel. This cannot be undone.')}
              </p>
            </div>
            <ToggleSwitch
              size="md"
              checked={props.isTeamChannel}
              disabled={
                props.disabled || props.isTeamChannel || !props.canConvertToTeam
              }
              onChange={(checked) => checked && props.onConvertToTeam()}
              label="Team channel"
              labelClass="sr-only"
            />
          </div>

          <Show when={props.isTeamChannel}>
            <div class="flex items-center justify-between gap-4 py-3">
              <div class="min-w-0">
                <div class="text-sm font-medium">Team auto-join</div>
                <p class="text-xs text-ink-muted">
                  Add current and future team members to this channel
                  automatically.
                </p>
              </div>
              <ToggleSwitch
                size="md"
                checked={props.autoJoinTeam}
                disabled={props.disabled}
                onChange={props.onAutoJoinTeamChange}
                label="Team auto-join"
                labelClass="sr-only"
              />
            </div>
          </Show>
        </div>
      </Panel.Body>
    </Panel>
  );
}
