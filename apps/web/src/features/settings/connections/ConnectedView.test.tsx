/**
 * @vitest-environment jsdom
 */

import {
  clearAllDebugSettings,
  DEBUG_SETTING_KEYS,
  setDebugSetting,
} from '@app/lib/debugSettings';
import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectedView } from './ConnectedView';
import { toConnectionsModel } from './model';

const connectedCursor = toConnectionsModel({
  userId: 'macro|self',
  emailEnabled: true,
  calendarEnabled: true,
  emailLinks: [],
  github: { status: 'unlinked', username: undefined },
  pipedream: [],
  nativeMcp: [],
  cursorRegistered: true,
});

afterEach(() => {
  clearAllDebugSettings();
});

describe('ConnectedView', () => {
  it('lists connected providers when the debug setting is off', () => {
    render(() => <ConnectedView model={connectedCursor} />);
    expect(screen.getByText('Cursor')).toBeTruthy();
    expect(screen.queryByText('Start with Google')).toBeNull();
  });

  it('shows the empty starters when Force empty states is on', () => {
    setDebugSetting(DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES, true);
    render(() => <ConnectedView model={connectedCursor} />);
    expect(screen.getByText('Start with Google')).toBeTruthy();
    expect(screen.getByText('Browse all Connections')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a connection' })).toBeNull();
  });
});
