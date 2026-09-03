import { defineDoc } from '@app/features/ui-gallery/types';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { For } from 'solid-js';
import { Badge, type BadgeVariant } from './Badge';

const VARIANTS: BadgeVariant[] = ['ghost', 'outline'];

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex w-full flex-col gap-3">
      <For each={VARIANTS}>
        {(variant) => (
          <div class="flex items-center gap-3">
            <span class="w-16 shrink-0 font-mono text-xs text-ink-subtle">
              {variant}
            </span>
            <Badge variant={variant}>Badge</Badge>
            <Badge variant={variant}>
              <CheckIcon />
              With icon
            </Badge>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex flex-wrap items-end gap-3">
      <For each={['sm', 'md', 'lg'] as const}>
        {(size) => (
          <div class="flex flex-col items-start gap-1.5">
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
            <Badge variant="outline" size={size}>
              Badge
            </Badge>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:content
function ContentDemo() {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="outline" size="sm">
        <span aria-hidden="true" class="size-2 rounded-full bg-blue" />
        design
      </Badge>
      <Badge variant="outline" size="sm">
        <span aria-hidden="true" class="size-2 rounded-full bg-pink" />
        tags-ux
      </Badge>
      <Badge variant="outline" size="sm">
        <span class="inline-flex size-[1em] items-center justify-center rounded-full bg-green text-surface-4">
          <CheckIcon aria-hidden="true" class="size-[0.65em]" />
        </span>
        Completed
        <CaretDownIcon aria-hidden="true" />
      </Badge>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Badge',
  category: 'Data Display',
  description:
    'A small, non-interactive label for status, counts, and tags. Shares Button’s size scale so a badge and a button of the same size sit on the same line cleanly.',
  status: 'stable',
  exports: ['Badge'],
  import: "import { Badge } from '@ui';",
  demos: [
    {
      id: 'variants',
      title: 'Variants',
      description:
        '`ghost` when the surrounding container already provides separation, `outline` when the badge needs its own edge.',
      render: VariantsDemo,
      fill: true,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      description: 'Matches the Button `sm` / `md` / `lg` control sizes.',
      render: SizesDemo,
    },
    {
      id: 'content',
      title: 'Composed content',
      description:
        'Badges take arbitrary children — a color dot for a tag, a status glyph, a caret when the badge is the visible half of a menu trigger.',
      render: ContentDemo,
    },
  ],
  props: [
    {
      name: 'variant',
      type: "'ghost' | 'outline'",
      default: "'ghost'",
      description: 'Whether the badge draws its own border.',
    },
    {
      name: 'size',
      type: "'sm' | 'md' | 'lg'",
      default: "'md'",
      description: 'Height, padding, and icon scale.',
    },
  ],
  guidelines: {
    do: [
      'Keep badge text to a word or two.',
      'Use `badgeTriggerClasses` when a badge needs to behave like a button.',
      'Use a palette color for identity (tags, calendars) and a semantic color for state.',
    ],
    dont: [
      'Do not attach a click handler to `Badge` directly — it renders a `span`.',
      'Do not use a badge where a Tooltip would carry the information better.',
    ],
  },
});
