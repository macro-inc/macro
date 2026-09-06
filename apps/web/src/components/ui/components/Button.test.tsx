import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, buttonClasses, buttonVariants } from './Button';
import { ButtonGroup } from './ButtonGroup';

describe('buttonClasses', () => {
  it('exposes the underlying variant helper', () => {
    const classes = buttonVariants({ variant: 'outline', size: 'sm' });

    expect(classes).toContain('border-edge-muted');
    expect(classes).toContain('h-6');
  });

  it('returns reusable variant and size classes with caller overrides', () => {
    const classes = buttonClasses({
      variant: 'outline',
      size: 'icon-sm',
      noTouchResize: true,
      class: 'size-8 rounded-full',
    });

    expect(classes).toContain('border-edge-muted');
    expect(classes).toContain('size-8');
    expect(classes).not.toContain('size-6');
    expect(classes).toContain('rounded-full');
    expect(classes).not.toContain('touch:min-h-9');
  });

  it('includes the complete CTA contrast treatment', () => {
    const classes = buttonClasses({ variant: 'cta' });

    expect(classes).toContain('text-accent-contrast');
    expect(classes).toContain(
      '[--color-edge:var(--color-accent-contrast-muted)]'
    );
  });

  it('includes the inverted strong treatment', () => {
    const classes = buttonClasses({ variant: 'strong' });

    expect(classes).toContain('bg-ink');
    expect(classes).toContain('text-surface-4');
    expect(classes).toContain('focus-visible:ring-surface-4/70');
  });

  it.each([
    ['sm', 'h-6', 'px-2', 'text-xs'],
    ['md', 'h-8', 'px-2', 'text-sm'],
    ['lg', 'h-9', 'px-3', 'text-base'],
    ['xl', 'h-12', 'px-4', 'text-base'],
  ] as const)(
    'gives %s buttons the intended height, padding, and text size',
    (size, heightClass, paddingClass, textClass) => {
      const classes = buttonClasses({ size });

      expect(classes).toContain(heightClass);
      expect(classes).toContain(paddingClass);
      expect(classes).toContain(textClass);
      expect(classes).not.toContain('[&>svg');
      expect(classes).not.toContain('aspect-square');
      expect(classes).not.toContain('p-0');
    }
  );

  it.each([
    ['icon-xs', 'size-5', 'text-base'],
    ['icon-sm', 'size-6', 'text-base'],
    ['icon-md', 'size-9', 'text-2xl'],
    ['icon-lg', 'size-11', 'text-[1.75rem]'],
  ] as const)(
    'sets icon %s font size without locking svg children',
    (size, buttonSize, textClass) => {
      const classes = buttonClasses({ size });

      expect(classes).toContain(buttonSize);
      expect(classes).toContain(textClass);
      expect(classes).not.toContain('[&>svg');
    }
  );

  it('applies icon-only geometry explicitly without changing the size', () => {
    const classes = buttonClasses({ size: 'md', square: true });

    expect(classes).toContain('h-8');
    expect(classes).toContain('aspect-square');
    expect(classes).toContain('p-0');
    expect(classes).not.toContain('px-2');
  });

  it('keeps large-button horizontal padding restrained', () => {
    const classes = buttonClasses({ size: 'lg' });

    expect(classes).toContain('px-3');
    expect(classes).not.toContain('px-6');
  });
});

describe('Button', () => {
  afterEach(cleanup);

  it('uses label as its accessible name and default tooltip content', () => {
    render(() => (
      <Button size="icon-sm" label="Close">
        <svg aria-hidden="true" />
      </Button>
    ));

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('uses an icon button tooltip as an accessible-name fallback', () => {
    render(() => (
      <Button size="icon-sm" tooltip="Search">
        <svg aria-hidden="true" />
      </Button>
    ));

    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('uses a square button tooltip as an accessible-name fallback', () => {
    render(() => (
      <Button size="sm" square tooltip="Search">
        <svg aria-hidden="true" />
      </Button>
    ));

    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('does not replace visible text with tooltip content', () => {
    render(() => <Button tooltip="Save the current draft">Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('does not leak custom props and preserves CTA inline styles', () => {
    render(() => (
      <Button variant="cta" noTouchResize style={{ color: 'rgb(1, 2, 3)' }}>
        Continue
      </Button>
    ));

    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button.hasAttribute('notouchresize')).toBe(false);
    expect(button.style.color).toBe('rgb(1, 2, 3)');
  });

  it('exposes its resolved variant and size as data attributes', () => {
    render(() => (
      <ButtonGroup variant="accent" size="icon-xs">
        <Button label="Pinned">
          <svg aria-hidden="true" />
        </Button>
      </ButtonGroup>
    ));

    const button = screen.getByRole('button', { name: 'Pinned' });
    expect(button.dataset.slot).toBe('button');
    expect(button.dataset.variant).toBe('accent');
    expect(button.dataset.size).toBe('icon-xs');
  });
});
