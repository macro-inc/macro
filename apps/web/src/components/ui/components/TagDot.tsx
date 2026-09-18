import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants, type VariantProps } from '../utils/variants';

const tagDotVariants = createVariants(
  'inline-block shrink-0 rounded-full',
  { size: { sm: 'size-2', md: 'size-2.5', lg: 'size-3' } },
  { size: 'md' }
);

export type TagDotSize = NonNullable<
  VariantProps<typeof tagDotVariants>['size']
>;
export type TagDotProps = Omit<ComponentProps<'span'>, 'children' | 'style'> &
  VariantProps<typeof tagDotVariants> &
  (
    | { fill?: string; fills?: never }
    | { fill?: never; fills: readonly string[] }
  );

/** A color dot with up to four distinct fills, in input order.
 * Repeating a fill increases its share of the pie.
 *
 * @do Pair the dot with a text label so color is not the only identifier.
 * @do Put the parent tag's fill first when summarizing a tag branch.
 */
export function TagDot(props: TagDotProps) {
  const [local, others] = splitProps(props, ['fill', 'fills', 'size', 'class']);
  const fillStyle = (): JSX.CSSProperties => {
    const counts = new Map<string, number>();
    for (const fill of local.fills ?? []) {
      if (counts.has(fill) || counts.size < 4) {
        counts.set(fill, (counts.get(fill) ?? 0) + 1);
      }
    }
    if (counts.size <= 1) {
      return {
        'background-color':
          counts.keys().next().value ??
          local.fill ??
          'var(--color-ink-extra-muted)',
      };
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    let start = 0;
    return {
      'background-image': `conic-gradient(${[...counts]
        .map(([fill, count]) => {
          const end = start + (count / total) * 100;
          const slice = `${fill} ${start}% ${end}%`;
          start = end;
          return slice;
        })
        .join(', ')})`,
    };
  };

  return (
    <span
      aria-hidden="true"
      {...others}
      data-slot="tag-dot"
      data-size={local.size ?? 'md'}
      class={cn(tagDotVariants({ size: local.size }), local.class)}
      style={fillStyle()}
    />
  );
}
