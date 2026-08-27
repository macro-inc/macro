import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge, badgeClasses, badgeTriggerClasses } from './Badge';
import { buttonClasses } from './Button';

describe('badgeClasses', () => {
  it('provides ghost and outline variants', () => {
    expect(badgeClasses({ variant: 'ghost' })).toContain('bg-transparent');
    expect(badgeClasses({ variant: 'outline' })).toContain('border-edge-muted');
  });

  it.each(['sm', 'md', 'lg'] as const)(
    'mirrors the %s Button size classes',
    (size) => {
      const badge = badgeClasses({ size }).split(' ');
      const button = buttonClasses({ size, noTouchResize: true }).split(' ');

      for (const sizeClass of badge) {
        if (
          sizeClass.startsWith('h-') ||
          sizeClass.startsWith('px-') ||
          sizeClass.startsWith('gap-') ||
          sizeClass.startsWith('text-') ||
          sizeClass.startsWith('[&>svg')
        ) {
          expect(button).toContain(sizeClass);
        }
      }
    }
  );

  it('merges caller overrides without allowing a non-pill shape', () => {
    const classes = badgeClasses({ size: 'md', class: 'h-5 rounded-md' });

    expect(classes).toContain('h-5');
    expect(classes).not.toContain('h-8');
    expect(classes).toContain('rounded-full');
    expect(classes).not.toContain('rounded-md');
  });

  it.each(['sm', 'md', 'lg'] as const)('is rounded-full at size %s', (size) => {
    expect(badgeClasses({ size })).toContain('rounded-full');
  });
});

describe('Badge', () => {
  afterEach(cleanup);

  it('renders a span with resolved variant and size metadata', () => {
    render(() => (
      <Badge variant="outline" size="sm" title="Status">
        Ready
      </Badge>
    ));

    const badge = screen.getByText('Ready');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.getAttribute('title')).toBe('Status');
    expect(badge.dataset.slot).toBe('badge');
    expect(badge.dataset.variant).toBe('outline');
    expect(badge.dataset.size).toBe('sm');
  });
});

describe('badgeTriggerClasses', () => {
  it('adds Button interaction states without changing the pill shape', () => {
    const passive = badgeClasses({ variant: 'outline', size: 'sm' });
    const interactive = badgeTriggerClasses({
      variant: 'outline',
      size: 'sm',
    });

    expect(passive).not.toContain('not-disabled:hover:bg-hover');
    expect(interactive).toContain('not-disabled:hover:bg-hover');
    expect(interactive).toContain('not-disabled:active:bg-active');
    expect(interactive).toContain('focus-visible:ring-2');
    expect(interactive).toContain('rounded-full');
    expect(interactive).toContain('h-6');
  });
});
