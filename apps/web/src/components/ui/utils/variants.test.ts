import { describe, expect, expectTypeOf, it } from 'vitest';
import { createVariants, type VariantProps } from './variants';

const badgeVariants = createVariants(
  'inline-flex rounded px-2',
  {
    tone: {
      neutral: 'bg-surface text-ink',
      positive: 'bg-success-bg text-success',
    },
    size: {
      sm: 'h-5 px-1 text-xs',
      md: 'h-7 px-3 text-sm',
    },
  },
  {
    tone: 'neutral',
    size: 'md',
  }
);

describe('createVariants', () => {
  it('combines the base with selected variant classes', () => {
    const classes = badgeVariants({ tone: 'positive', size: 'sm' });

    expect(classes).toContain('inline-flex');
    expect(classes).toContain('bg-success-bg');
    expect(classes).toContain('h-5');
  });

  it('uses defaults for omitted selections', () => {
    const classes = badgeVariants({ tone: 'positive' });

    expect(classes).toContain('bg-success-bg');
    expect(classes).toContain('h-7');
  });

  it('omits a group with no selection or default', () => {
    const withoutDefaults = createVariants('base', {
      emphasis: {
        quiet: 'opacity-60',
      },
    });

    expect(withoutDefaults()).toBe('base');
  });

  it('merges conflicting Tailwind classes in variant order', () => {
    const classes = badgeVariants({ size: 'sm' });

    expect(classes).toContain('px-1');
    expect(classes).not.toContain('px-2');
    expect(classes).not.toContain('px-3');
  });

  it('infers group names and their allowed string values', () => {
    type BadgeVariantProps = VariantProps<typeof badgeVariants>;

    expectTypeOf<BadgeVariantProps>().toEqualTypeOf<{
      tone?: 'neutral' | 'positive';
      size?: 'sm' | 'md';
    }>();
  });
});
