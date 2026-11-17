/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncStatus } from './SyncStatus';

const status = () => screen.getByRole('status').textContent;

afterEach(() => {
  cleanup();
});

describe('SyncStatus', () => {
  it('says events are being imported while the calendar syncs', () => {
    render(() => <SyncStatus syncing />);

    expect(status()).toBe(
      'Syncing your calendar…Events are being imported. This may take a while. You can keep using Macro as normal.'
    );
  });

  it('never suggests turning the calendar off', () => {
    render(() => <SyncStatus syncing />);

    expect(status()?.toLowerCase()).not.toMatch(/turn|disable|remove|off/);
  });

  it('disappears once the import finishes', () => {
    const [syncing, setSyncing] = createSignal(true);
    render(() => <SyncStatus syncing={syncing()} />);

    expect(screen.getByRole('status')).toBeTruthy();
    setSyncing(false);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
