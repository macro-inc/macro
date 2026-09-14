/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AgentEffortSelector } from './AgentEffortSelector';

describe('AgentEffortSelector', () => {
  it('opens its options inside a menu group', async () => {
    window.scrollTo = vi.fn();
    render(() => (
      <AgentEffortSelector
        current="medium"
        options={[
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ]}
        onSelect={vi.fn()}
      />
    ));

    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reasoning effort' }),
      { key: 'ArrowDown' }
    );
    expect(await screen.findByRole('menuitem', { name: 'High' })).toBeTruthy();
  });
});
