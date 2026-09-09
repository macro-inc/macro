import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { ButtonGroup } from './ButtonGroup';
import { InputGroup, inputGroupVariants } from './InputGroup';

afterEach(cleanup);

describe('inputGroupVariants', () => {
  it('owns the standard input background and focus treatment', () => {
    const classes = inputGroupVariants().split(' ');

    expect(classes).toContain('bg-input');
    expect(classes).toContain('border-edge-muted');
    expect(classes).toContain(
      'has-[[data-slot=input-group-control]:focus-visible]:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))]'
    );
    expect(classes).toContain(
      'has-[[data-slot=input-group-control]:focus-visible]:ring-edge-muted'
    );
  });

  it('keeps the bare composition free of focus chrome', () => {
    const classes = inputGroupVariants({ variant: 'bare' }).split(' ');

    expect(classes).toContain('bg-transparent');
    expect(classes).toContain('border-transparent');
    expect(
      classes.some((className) => className.includes(':focus-visible]'))
    ).toBe(false);
  });
});

describe('InputGroup', () => {
  it('composes a thin input with visually aligned addons', () => {
    render(() => (
      <InputGroup>
        <InputGroup.Input aria-label="Search" />
        <InputGroup.Addon align="inline-start">
          <svg data-testid="leading-icon" />
        </InputGroup.Addon>
        <InputGroup.Addon align="inline-end">
          <span data-testid="trailing-addon">⌘K</span>
        </InputGroup.Addon>
      </InputGroup>
    ));

    const input = screen.getByRole('textbox', { name: 'Search' });
    const leading = screen.getByTestId('leading-icon').parentElement;
    const trailing = screen.getByTestId('trailing-addon').parentElement;

    expect(input.dataset.slot).toBe('input-group-control');
    expect(input.dataset.variant).toBe('bare');
    expect(input.classList).toContain('border-0');
    expect(leading?.dataset.align).toBe('inline-start');
    expect(leading?.classList).toContain('order-first');
    expect(trailing?.dataset.align).toBe('inline-end');
    expect(trailing?.classList).toContain('order-last');
  });

  it('focuses the input when a non-interactive addon is clicked', () => {
    render(() => (
      <InputGroup>
        <InputGroup.Input aria-label="Amount" />
        <InputGroup.Addon data-testid="currency">$</InputGroup.Addon>
      </InputGroup>
    ));

    fireEvent.click(screen.getByTestId('currency'));
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Amount' })
    );
  });

  it('clears through the native input event path and restores focus', async () => {
    function ClearableGroup() {
      const [value, setValue] = createSignal('documents');

      return (
        <InputGroup>
          <InputGroup.Input
            type="search"
            value={value()}
            onInput={(event) => setValue(event.currentTarget.value)}
            aria-label="Search"
          />
          <InputGroup.Addon align="inline-end">
            <InputGroup.ClearButton />
          </InputGroup.Addon>
        </InputGroup>
      );
    }

    render(() => <ClearableGroup />);

    const input = screen.getByRole('searchbox', { name: 'Search' });
    const clearButton = screen.getByRole('button', { name: 'Clear input' });
    const addon = clearButton.closest('[data-slot="input-group-addon"]');

    expect(input.classList).toContain(
      '[&::-webkit-search-cancel-button]:hidden'
    );
    expect(clearButton.hasAttribute('data-button')).toBe(true);
    expect(addon?.classList).toContain('[&:has([data-button])]:pe-1');
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(clearButton);
    await Promise.resolve();

    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear input' })).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('inherits framing and size when nested in ButtonGroup', () => {
    const { container } = render(() => (
      <ButtonGroup variant="outline" size="sm">
        <InputGroup>
          <InputGroup.Input aria-label="Search" />
        </InputGroup>
        <Button>Go</Button>
      </ButtonGroup>
    ));

    const group = container.querySelector('[data-slot="input-group"]');
    const input = screen.getByRole('textbox', { name: 'Search' });

    expect(group?.getAttribute('data-grouped')).toBe('');
    expect(group?.getAttribute('data-size')).toBe('sm');
    expect(group?.classList).toContain('border-0');
    expect(input.dataset.size).toBe('sm');
    expect(input.classList).toContain('h-full');
  });
});
