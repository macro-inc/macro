/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { onMount } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { ModelCatalogPicker } from './ModelCatalogPicker';

// Exercise the picker's focus contract without Kobalte's CSS-presence layer,
// whose close animation never completes in jsdom.
vi.mock('@ui', () => {
  const cn = (...args: unknown[]) =>
    args.flat(Infinity).filter(Boolean).join(' ');
  let trigger: HTMLButtonElement | undefined;
  const Dropdown: any = (props: any) => <div>{props.children}</div>;
  Dropdown.Trigger = (props: any) => (
    <button ref={trigger} type="button" aria-label={props['aria-label']}>
      {props.children}
    </button>
  );
  Dropdown.Content = (props: any) => {
    onMount(() => props.onOpenAutoFocus?.(new Event('open')));
    return (
      <div
        role="menu"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          props.onEscapeKeyDown?.(event);
          props.onCloseAutoFocus?.(new Event('close', { cancelable: true }));
          // Kobalte does this after calling onCloseAutoFocus.
          trigger?.focus();
        }}
      >
        {props.children}
      </div>
    );
  };
  Dropdown.Group = (props: any) => <div>{props.children}</div>;
  Dropdown.GroupLabel = (props: any) => <div>{props.children}</div>;
  Dropdown.Item = (props: any) => <div>{props.children}</div>;
  Dropdown.Separator = () => <hr />;
  Dropdown.Sub = (props: any) => <div>{props.children}</div>;
  Dropdown.SubTrigger = (props: any) => <div>{props.children}</div>;
  Dropdown.SubContent = (props: any) => <div>{props.children}</div>;
  return { cn, Dropdown };
});

const OPTIONS = Array.from({ length: 11 }, (_, index) => ({
  id: `model-${index}`,
  label: `Model ${index}`,
}));

describe('ModelCatalogPicker focus', () => {
  it('focuses search on open and delegates focus restoration after Escape', async () => {
    const user = userEvent.setup();
    const restoreComposerFocus = vi.fn(() => composer.focus());
    let composer!: HTMLButtonElement;

    render(() => (
      <>
        <button ref={composer} type="button">
          Agent composer
        </button>
        <ModelCatalogPicker
          value={OPTIONS[0]!.id}
          options={OPTIONS}
          onSelect={() => {}}
          onEscape={restoreComposerFocus}
          ariaLabel="Agent model"
        />
      </>
    ));

    const search = await screen.findByRole('textbox', {
      name: 'Search models',
    });
    await waitFor(() => expect(document.activeElement).toBe(search));

    // Hovering model rows can move focus away from search. Escape must still
    // restore the composer from anywhere in the picker.
    screen.getByRole('menu').focus();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(restoreComposerFocus).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(composer);
    });
  });
});
