/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ChannelTeamSettingsPanel } from './ChannelTeamSettingsPanel';

describe('ChannelTeamSettingsPanel', () => {
  it('allows converting an eligible channel to a team channel', () => {
    const onConvertToTeam = vi.fn();

    render(() => (
      <ChannelTeamSettingsPanel
        isTeamChannel={false}
        autoJoinTeam={false}
        canConvertToTeam
        disabled={false}
        onConvertToTeam={onConvertToTeam}
        onAutoJoinTeamChange={vi.fn()}
      />
    ));

    expect(screen.getByText('Team access').closest('section')).not.toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Team channel' }));

    expect(onConvertToTeam).toHaveBeenCalledOnce();
    expect(screen.queryByRole('switch', { name: 'Team auto-join' })).toBeNull();
  });

  it('disables conversion when the user does not have a team', () => {
    render(() => (
      <ChannelTeamSettingsPanel
        isTeamChannel={false}
        autoJoinTeam={false}
        canConvertToTeam={false}
        conversionUnavailableReason="You need to belong to a team."
        disabled={false}
        onConvertToTeam={vi.fn()}
        onAutoJoinTeamChange={vi.fn()}
      />
    ));

    expect(screen.getByRole('switch', { name: 'Team channel' })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByText('You need to belong to a team.')).toBeTruthy();
  });

  it('allows toggling auto-join for a team channel', () => {
    const onAutoJoinTeamChange = vi.fn();

    render(() => (
      <ChannelTeamSettingsPanel
        isTeamChannel
        autoJoinTeam={false}
        canConvertToTeam={false}
        disabled={false}
        onConvertToTeam={vi.fn()}
        onAutoJoinTeamChange={onAutoJoinTeamChange}
      />
    ));

    const teamChannelSwitch = screen.getByRole('switch', {
      name: 'Team channel',
    });
    expect(teamChannelSwitch).toHaveProperty('checked', true);
    expect(teamChannelSwitch).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('switch', { name: 'Team auto-join' }));
    expect(onAutoJoinTeamChange).toHaveBeenCalledWith(true);
  });
});
