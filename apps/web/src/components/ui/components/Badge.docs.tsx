import { defineDoc } from '@app/features/ui-gallery/types';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import ShareIcon from '@icon/share.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import { For } from 'solid-js';
import { Avatar } from './Avatar';
import { Badge, type BadgeVariant, CountBadge } from './Badge';
import { Button } from './Button';

const VARIANTS: BadgeVariant[] = [
  'ghost',
  'outline',
  'accent',
  'violet',
  'success',
];

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

// #region demo:avatars
function AvatarsDemo() {
  return (
    <div class="flex flex-wrap items-end gap-3">
      <For each={['xs', 'sm', 'md', 'lg'] as const}>
        {(size) => (
          <div class="flex flex-col items-start gap-1.5">
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
            <Badge variant="outline" size={size}>
              <Avatar size={size === 'xs' || size === 'sm' ? 'sm' : 'md'}>
                <Avatar.Fallback>JD</Avatar.Fallback>
              </Avatar>
              Jordan
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
      <For each={['xs', 'sm', 'md', 'lg'] as const}>
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

// #region demo:counts
function CountsDemo() {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <For each={[1, 12, 140]}>
        {(count) => (
          <Button variant="ghost" size="md" aria-label="Filter tasks">
            <FilterIcon class="size-4 shrink-0" />
            <CountBadge count={count} />
          </Button>
        )}
      </For>
      <HeaderActionButton
        label="Share"
        icon={<ShareIcon class="size-4" />}
        count={1}
        countLabel="1 pending permission request"
        onClick={() => {}}
      />
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
  exports: ['Badge', 'CountBadge'],
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
      description:
        'Matches the Button `xs` / `sm` / `md` / `lg` control sizes.',
      render: SizesDemo,
    },
    {
      id: 'content',
      title: 'Composed content',
      description:
        'Badges take arbitrary children — a color dot for a tag, a status glyph, a caret when the badge is the visible half of a menu trigger.',
      render: ContentDemo,
    },
    {
      id: 'counts',
      title: 'Counts',
      description:
        '`CountBadge` sits inside a control, after its icon or label, and the control grows to fit it. Name what it counts in the control’s accessible label or tooltip. Counts above 99 show 99+.',
      render: CountsDemo,
    },
    {
      id: 'avatars',
      title: 'Leading avatars',
      description:
        'Use a small Avatar in xs / sm badges and a medium Avatar in md / lg badges. Each gets an even circular inset; text-only badges retain their usual padding.',
      render: AvatarsDemo,
    },
  ],
});
