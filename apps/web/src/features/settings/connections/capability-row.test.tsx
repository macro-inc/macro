/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { CapabilityRow } from './capability-row';

describe('CapabilityRow', () => {
  it('paints Off only when status is off', () => {
    const { unmount } = render(() => (
      <CapabilityRow title="Gmail" outcome="Read mail" status="off" />
    ));
    expect(screen.getByRole('img', { name: 'Off' })).toBeTruthy();
    unmount();

    render(() => (
      <CapabilityRow title="Gmail" outcome="Read mail" status="connected" />
    ));
    expect(screen.queryByRole('img')).toBeNull();
  });
});
