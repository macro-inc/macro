import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CallSettingsCapabilities,
  CallSettingsProvider,
} from '../context/call-settings-context';
import type {
  RecordingKinds,
  RecordingSettings,
} from '../core/recording-kinds';
import { CallSettingsView } from './call-settings-view';

afterEach(cleanup);

const ALL: RecordingKinds = {
  huddles: true,
  internalMeetings: true,
  externalMeetings: true,
};
const NONE: RecordingKinds = {
  huddles: false,
  internalMeetings: false,
  externalMeetings: false,
};

function renderView(
  initial: RecordingSettings | undefined,
  options: { error?: boolean } = {}
) {
  const [settings] = createSignal(initial);
  const capabilities: CallSettingsCapabilities = {
    createSource: () => ({
      settings,
      error: () => options.error ?? false,
    }),
    setRecordByDefault: vi.fn(),
    setTeamBlock: vi.fn(),
  };
  render(() => (
    <CallSettingsProvider value={capabilities}>
      <CallSettingsView />
    </CallSettingsProvider>
  ));
  return capabilities;
}

const checkbox = (name: string) =>
  screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('Calls settings', () => {
  it('shows each record-by-default option and saves a change', () => {
    const calls = renderView({
      recordByDefault: { ...ALL, externalMeetings: false },
      team: null,
    });
    expect(checkbox('Huddles').checked).toBe(true);
    expect(checkbox('Internal meetings').checked).toBe(true);
    expect(checkbox('External meetings').checked).toBe(false);

    fireEvent.click(checkbox('Huddles'));
    expect(calls.setRecordByDefault).toHaveBeenCalledWith('huddles', false);
    fireEvent.click(checkbox('External meetings'));
    expect(calls.setRecordByDefault).toHaveBeenCalledWith(
      'externalMeetings',
      true
    );
  });

  it('hides the team policy for people without a team', () => {
    renderView({ recordByDefault: ALL, team: null });
    expect(screen.queryByText('Team recording policy')).toBeNull();
  });

  it('lets team admins block recording', () => {
    const calls = renderView({
      recordByDefault: ALL,
      team: { blocked: NONE, canEdit: true },
    });
    expect(screen.queryByText('Admins only')).toBeNull();
    const block = checkbox('Block internal meetings');
    expect(block.disabled).toBe(false);
    fireEvent.click(block);
    expect(calls.setTeamBlock).toHaveBeenCalledWith('internalMeetings', true);
  });

  it('shows the team policy to members but greys it out', () => {
    const calls = renderView({
      recordByDefault: ALL,
      team: { blocked: { ...NONE, huddles: true }, canEdit: false },
    });
    expect(screen.getByText('Admins only')).toBeTruthy();
    for (const name of [
      'Block huddles',
      'Block internal meetings',
      'Block external meetings',
    ]) {
      const block = checkbox(name);
      expect(block.disabled).toBe(true);
      expect(block.closest('[data-settings-target]')?.className).toContain(
        'cursor-not-allowed'
      );
      fireEvent.click(block);
    }
    expect(checkbox('Block huddles').checked).toBe(true);
    expect(calls.setTeamBlock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText('Only team admins can change this.')
    ).toHaveLength(3);
  });

  it('turns off and locks a personal default the team blocks', () => {
    const calls = renderView({
      recordByDefault: ALL,
      team: {
        blocked: { ...NONE, externalMeetings: true },
        canEdit: false,
      },
    });
    const external = checkbox('External meetings');
    expect(external.checked).toBe(false);
    expect(external.disabled).toBe(true);
    expect(
      screen.getByText('Your team admins have blocked recording these calls.')
    ).toBeTruthy();
    fireEvent.click(external);
    expect(calls.setRecordByDefault).not.toHaveBeenCalled();
    expect(checkbox('Huddles').disabled).toBe(false);
  });

  it('shows loading and error states', () => {
    renderView(undefined);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    cleanup();
    renderView(undefined, { error: true });
    expect(screen.getByRole('alert').textContent).toContain("couldn't load");
  });
});
