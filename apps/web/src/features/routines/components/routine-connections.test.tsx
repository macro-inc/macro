import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { RoutineApp } from '../core/draft';
import { ConnectionRows } from './routine-connections';

const linear: RoutineApp = { app_slug: 'linear', server_name: 'Linear' };
const notion: RoutineApp = { app_slug: 'notion', server_name: 'Notion' };

function renderRows(connected: ReadonlySet<string> | undefined) {
  const [apps, setApps] = createSignal([linear, notion]);
  render(() => (
    <ConnectionRows
      apps={apps()}
      agent
      connected={() => connected}
      onChange={setApps}
      Picker={() => null}
      Connect={(props) => (
        <button type="button">Connect {props.app.server_name}</button>
      )}
    />
  ));
}

describe('ConnectionRows', () => {
  it('offers to connect each required app the viewer has not connected', () => {
    renderRows(new Set(['linear']));
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(
      screen.getByText('Not connected. Connect it before the routine runs.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Linear' })).toBeNull();
  });

  it('offers no connecting before the viewer’s connections load', () => {
    renderRows(undefined);
    expect(screen.queryByRole('button', { name: /^Connect / })).toBeNull();
  });
});
