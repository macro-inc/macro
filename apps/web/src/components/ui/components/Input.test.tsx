import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Input, inputClasses } from './Input';

afterEach(cleanup);

describe('inputClasses', () => {
  it.each([
    ['xs', 'h-5', 'px-1', 'text-xs'],
    ['sm', 'h-6', 'px-2', 'text-xs'],
    ['md', 'h-8', 'px-2', 'text-sm'],
    ['lg', 'h-9', 'px-3', 'text-base'],
    ['xl', 'h-12', 'px-4', 'text-base'],
  ] as const)(
    'matches the %s text Button size',
    (size, height, padding, text) => {
      const classes = inputClasses({ size }).split(' ');

      expect(classes).toContain(height);
      expect(classes).toContain(padding);
      expect(classes).toContain(text);
    }
  );

  it('provides outline and bare variants', () => {
    const outlineClasses = inputClasses({ variant: 'outline' }).split(' ');
    expect(outlineClasses).toContain('border-edge-muted');
    expect(outlineClasses).toContain('bg-input');
    expect(outlineClasses).not.toContain('bg-inset');
    expect(outlineClasses).toContain(
      'focus-visible:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))]'
    );
    expect(outlineClasses).toContain('focus-visible:ring-edge-muted');
    expect(outlineClasses).not.toContain('focus-visible:ring-accent/20');
    const bareClasses = inputClasses({ variant: 'bare' }).split(' ');
    expect(bareClasses).toContain('border-transparent');
    expect(bareClasses).toContain('bg-transparent');
    expect(
      bareClasses.some((className) => className.startsWith('hover:'))
    ).toBe(false);
    expect(
      bareClasses.some((className) => className.startsWith('focus-visible:'))
    ).toBe(false);
  });
});

describe('Input', () => {
  it('forwards the native shadcn-style input props', () => {
    render(() => (
      <Input
        aria-label="Email"
        type="email"
        name="email"
        placeholder="name@example.com"
        required
      />
    ));

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('name')).toBe('email');
    expect(input.getAttribute('placeholder')).toBe('name@example.com');
    expect(input.hasAttribute('required')).toBe(true);
    expect(input.dataset.slot).toBe('input');
    expect(input.classList).toContain('caret-current');
  });

  it('keeps numeric size as the native HTML attribute', () => {
    render(() => <Input aria-label="Code" size={24} />);

    const input = screen.getByRole('textbox', { name: 'Code' });
    expect(input.getAttribute('size')).toBe('24');
    expect(input.dataset.size).toBe('md');
  });

  it('uses string size as the visual Button size', () => {
    render(() => <Input aria-label="Code" size="sm" />);

    const input = screen.getByRole('textbox', { name: 'Code' });
    expect(input.hasAttribute('size')).toBe(false);
    expect(input.dataset.size).toBe('sm');
    expect(input.classList).toContain('h-6');
  });

  it('does not carry composition-specific wrappers or slots', () => {
    const { container } = render(() => <Input aria-label="Search" />);

    expect(container.querySelector('[data-slot="input-wrapper"]')).toBeNull();
    expect(container.querySelectorAll('[data-input]')).toHaveLength(1);
  });
});
