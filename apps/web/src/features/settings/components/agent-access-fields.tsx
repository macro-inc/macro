import { Show } from 'solid-js';
import { ChannelMultiSelect } from '../../channel/Bots/ChannelMultiSelect';
import type { AgentShare, ChannelMode } from '../core/agent-settings';
import { ChoiceRow } from '../primitives';

/** Who can use an agent: just its creator, or the creator's team. */
export function AgentShareFields(props: {
  share: AgentShare;
  canMakePrivate: boolean;
  canShareWithTeam: boolean;
  onChange: (share: AgentShare) => void;
}) {
  return (
    <>
      <fieldset class="grid grid-cols-1 gap-2 @min-[440px]:grid-cols-2">
        <legend class="sr-only">Share</legend>
        <ChoiceRow
          name="agent-share"
          value="private"
          checked={props.share === 'Private'}
          title="Private"
          description={
            props.canMakePrivate
              ? 'Only you can use and manage this agent.'
              : 'Only the agent creator can make it private.'
          }
          disabled={!props.canMakePrivate}
          onChange={() => props.onChange('Private')}
        />
        <ChoiceRow
          name="agent-share"
          value="team"
          checked={props.share === 'Team'}
          title="Team"
          description={
            props.canShareWithTeam
              ? 'Your team can use this agent in shared channels.'
              : 'Create or join a team before sharing agents.'
          }
          disabled={!props.canShareWithTeam}
          onChange={() => props.onChange('Team')}
        />
      </fieldset>
      <Show when={!props.canShareWithTeam}>
        <p class="mt-3 border-t border-edge-muted pt-3 text-xs text-ink-extra-muted">
          Team agents need a team owner. Create or join a team in Team settings
          to enable this option.
        </p>
      </Show>
    </>
  );
}

/** Where an agent can be mentioned: every channel, or the ones picked. */
export function AgentChannelFields(props: {
  mode: ChannelMode;
  channelIds: string[];
  onModeChange: (mode: ChannelMode) => void;
  onChannelIdsChange: (channelIds: string[]) => void;
}) {
  return (
    <>
      <fieldset class="flex flex-col gap-2">
        <legend class="sr-only">Channels</legend>
        <ChoiceRow
          name="agent-channel-mode"
          value="all"
          checked={props.mode === 'all'}
          title="All channels"
          description="The agent can be mentioned in every channel, like @macro."
          onChange={() => props.onModeChange('all')}
        />
        <ChoiceRow
          name="agent-channel-mode"
          value="selected"
          checked={props.mode === 'selected'}
          title="Specific channels"
          description="Only members of selected channels can use this agent."
          onChange={() => props.onModeChange('selected')}
        />
      </fieldset>
      <Show when={props.mode === 'selected'}>
        <div class="mt-3 border-t border-edge-muted pt-3">
          <ChannelMultiSelect
            channelIds={props.channelIds}
            onChange={props.onChannelIdsChange}
          />
        </div>
      </Show>
    </>
  );
}
