/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { HoverCard } from './HoverCard';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

async function renderOpenCard(keepOpenOnTriggerPress?: boolean) {
  const onOpenChange = vi.fn();
  render(() => (
    <>
      <HoverCard
        open
        onOpenChange={onOpenChange}
        keepOpenOnTriggerPress={keepOpenOnTriggerPress}
        trigger={<span>Standup</span>}
        content={<div>Card</div>}
      />
      <button type="button">Elsewhere</button>
    </>
  ));
  await screen.findByText('Card');
  // Kobalte attaches its outside pointer-down listener a tick after mount.
  await new Promise((resolve) => setTimeout(resolve));
  return onOpenChange;
}

describe('HoverCard', () => {
  it('dismisses when its trigger is pressed', async () => {
    const onOpenChange = await renderOpenCard();

    fireEvent.pointerDown(screen.getByText('Standup'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open when its trigger is pressed if asked to', async () => {
    const onOpenChange = await renderOpenCard(true);

    fireEvent.pointerDown(screen.getByText('Standup'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('still dismisses when pressed elsewhere if asked to keep open', async () => {
    const onOpenChange = await renderOpenCard(true);

    fireEvent.pointerDown(screen.getByText('Elsewhere'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
