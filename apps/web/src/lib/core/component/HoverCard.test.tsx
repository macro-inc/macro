/**
 * @vitest-environment jsdom
 */

import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoverCard as StyledHoverCard } from '../../../components/ui/components/HoverCard';
import { HoverCard } from './HoverCard';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

afterEach(() => {
  vi.mocked(isTouchDevice).mockReturnValue(false);
});

async function renderOpenCard(
  keepOpenOnTriggerPress?: boolean,
  closeOnScroll?: boolean,
  passThroughPointerEvents?: boolean
) {
  const onOpenChange = vi.fn();
  render(() => (
    <>
      <HoverCard
        open
        onOpenChange={onOpenChange}
        keepOpenOnTriggerPress={keepOpenOnTriggerPress}
        closeOnScroll={closeOnScroll}
        passThroughPointerEvents={passThroughPointerEvents}
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
  it('keeps the same button action without a hover preview on touch', () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    const activate = vi.fn();
    render(() => (
      <StyledHoverCard
        as="button"
        triggerAriaLabel="Folder"
        triggerOnClick={activate}
        content={<div>Folder preview</div>}
      >
        Folder name
      </StyledHoverCard>
    ));

    const trigger = screen.getByRole('button', { name: 'Folder' });
    expect(trigger.getAttribute('type')).toBe('button');
    expect(screen.queryByText('Folder preview')).toBeNull();
    fireEvent.click(trigger);
    expect(activate).toHaveBeenCalledOnce();
  });

  it('uses one non-submitting button for keyboard preview and activation', async () => {
    const activate = vi.fn();
    const submit = vi.fn();
    render(() => (
      <form onSubmit={submit}>
        <HoverCard
          triggerAs="button"
          triggerAriaLabel="Folder"
          triggerOnClick={activate}
          openDelay={0}
          trigger={<span>Folder name</span>}
          content={<div>Folder preview</div>}
        />
      </form>
    ));

    const trigger = screen.getByRole('button', { name: 'Folder' });
    expect(trigger.getAttribute('type')).toBe('button');
    expect(screen.getAllByRole('button')).toHaveLength(1);

    trigger.focus();
    expect(await screen.findByText('Folder preview')).toBeTruthy();
    fireEvent.click(trigger);
    expect(activate).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });
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

  it('dismisses on outside scrolling by default', async () => {
    const onOpenChange = await renderOpenCard();

    fireEvent.scroll(window);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps stationary previews open through trigger presses and scrolling', async () => {
    const onOpenChange = await renderOpenCard(true, false);

    fireEvent.pointerDown(screen.getByText('Standup'));
    fireEvent.scroll(window);

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.pointerDown(screen.getByText('Elsewhere'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('takes the pointer by default', async () => {
    await renderOpenCard();

    const content = screen.getByText('Card').parentElement;
    expect(content?.className).not.toContain('pointer-events-none');
    expect(
      content?.closest<HTMLElement>('[data-popper-positioner]')?.style
        .pointerEvents
    ).toBe('');
  });

  it('lets the pointer through the card and its positioner when asked', async () => {
    await renderOpenCard(undefined, undefined, true);

    const content = screen.getByText('Card').parentElement;
    expect(content?.className).toContain('pointer-events-none!');
    expect(
      content?.closest<HTMLElement>('[data-popper-positioner]')?.style
        .pointerEvents
    ).toBe('none');
  });
});
