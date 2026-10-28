import { Card, ToggleSwitch } from '@ui';
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
    <section>
      <Card>
        <Card.Header>
          <Card.Title>Team access</Card.Title>
        </Card.Header>
        <Card.Body>
          <div class="flex flex-col gap-4">
            <div>
              <ToggleSwitch
                checked={props.isTeamChannel}
                disabled={
                  props.disabled ||
                  props.isTeamChannel ||
                  !props.canConvertToTeam
                }
                onChange={(checked) => checked && props.onConvertToTeam()}
                label="Team channel"
              />
              <Card.Description>
                {props.isTeamChannel
                  ? 'This channel belongs to your team.'
                  : (props.conversionUnavailableReason ??
                    'Convert this channel into a team channel. This cannot be undone.')}
              </Card.Description>
            </div>
            <Show when={props.isTeamChannel}>
              <div>
                <ToggleSwitch
                  checked={props.autoJoinTeam}
                  disabled={props.disabled}
                  onChange={props.onAutoJoinTeamChange}
                  label="Team auto-join"
                />
                <Card.Description>
                  Add current and future team members to this channel
                  automatically.
                </Card.Description>
              </div>
            </Show>
          </div>
        </Card.Body>
      </Card>
    </section>
  );
}
