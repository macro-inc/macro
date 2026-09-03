import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { Avatar, AvatarGroup } from './Avatar';

/**
 * Sample portrait, served from `public/`. Built off `BASE_URL` rather than a
 * bare `/teo.png` because the app is served from `/` in dev and `/app` in a
 * build, and a hardcoded root path 404s in the latter.
 */
const TEO = `${import.meta.env.BASE_URL}teo.png`;

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex flex-wrap items-end gap-6">
      <For each={['sm', 'md', 'lg'] as const}>
        {(size) => (
          <div class="flex flex-col items-center gap-1.5">
            <Avatar size={size}>
              <Avatar.Fallback>TC</Avatar.Fallback>
            </Avatar>
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
          </div>
        )}
      </For>
      <div class="flex flex-col items-center gap-1.5">
        <div class="size-16">
          <Avatar size="fill">
            <Avatar.Fallback>TC</Avatar.Fallback>
          </Avatar>
        </div>
        <span class="font-mono text-xs text-ink-subtle">fill</span>
      </div>
    </div>
  );
}
// #endregion

// #region demo:image-and-fallback
function ImageAndFallbackDemo() {
  return (
    <div class="flex flex-wrap items-end gap-6">
      <div class="flex flex-col items-center gap-2">
        <Avatar size="lg">
          <Avatar.Image src={TEO} alt="Teo" />
          <Avatar.Fallback>TC</Avatar.Fallback>
        </Avatar>
        <span class="text-xs text-ink-subtle">Image loads</span>
      </div>
      <div class="flex flex-col items-center gap-2">
        <Avatar size="lg">
          <Avatar.Fallback>TC</Avatar.Fallback>
        </Avatar>
        <span class="text-xs text-ink-subtle">No image</span>
      </div>
      <div class="flex flex-col items-center gap-2">
        <Avatar size="lg">
          <Avatar.Image src="/does-not-exist.png" alt="Teo" />
          <Avatar.Fallback>TC</Avatar.Fallback>
        </Avatar>
        <span class="text-xs text-ink-subtle">Image 404s</span>
      </div>
    </div>
  );
}
// #endregion

// #region demo:edge
function EdgeDemo() {
  return (
    <div class="flex flex-wrap items-center gap-8">
      <div class="flex flex-col items-center gap-2">
        <div class="size-20">
          <Avatar size="fill" highlightEdge>
            <Avatar.Image src={TEO} alt="" />
          </Avatar>
        </div>
        <span class="text-xs text-ink-subtle">With hairline</span>
      </div>
      <div class="flex flex-col items-center gap-2">
        <div class="size-20">
          <Avatar size="fill">
            <Avatar.Image src={TEO} alt="" />
          </Avatar>
        </div>
        <span class="text-xs text-ink-subtle">Without</span>
      </div>
    </div>
  );
}
// #endregion

// #region demo:shape
function ShapeDemo() {
  return (
    <div class="flex flex-col gap-6">
      <For each={['rounded', 'square'] as const}>
        {(shape) => (
          <div class="flex items-end gap-4">
            <span class="w-16 font-mono text-xs text-ink-subtle">{shape}</span>
            <For each={['sm', 'md', 'lg'] as const}>
              {(size) => (
                <div class="flex flex-col items-center gap-1.5">
                  <Avatar size={size} shape={shape} highlightEdge>
                    <Avatar.Image src={TEO} alt="Teo" />
                  </Avatar>
                  <span class="font-mono text-xs text-ink-subtle">{size}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:group
function GroupDemo() {
  return (
    <div class="flex flex-col gap-6">
      <For each={['sm', 'md', 'lg'] as const}>
        {(size) => (
          <div class="flex items-center gap-3">
            <span class="w-8 font-mono text-xs text-ink-subtle">{size}</span>
            <AvatarGroup size={size}>
              <Avatar size={size}>
                <Avatar.Image src={TEO} alt="Teo" />
              </Avatar>
              <Avatar size={size}>
                <Avatar.Image src={TEO} alt="Teo" />
              </Avatar>
              <Avatar size={size}>
                <Avatar.Image src={TEO} alt="Teo" />
              </Avatar>
              <AvatarGroup.Count size={size}>+3</AvatarGroup.Count>
            </AvatarGroup>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:group-on-hover
function GroupOnHoverDemo() {
  return (
    <div class="flex w-full max-w-sm flex-col gap-1">
      <For each={['Design review', 'Launch checklist']}>
        {(label) => (
          <div class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-hover hover:[--avatar-group-separator:var(--color-hover)]">
            <span class="text-sm text-ink">{label}</span>
            <AvatarGroup size="sm">
              <Avatar size="sm">
                <Avatar.Image src={TEO} alt="Teo" />
              </Avatar>
              <Avatar size="sm">
                <Avatar.Image src={TEO} alt="Teo" />
              </Avatar>
            </AvatarGroup>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Avatar',
  category: 'Data Display',
  description:
    'A circular representation of a person. Takes an image, initials, or an icon, and carries a 1px inset hairline so a photo edge reads cleanly against any surface.',
  status: 'stable',
  exports: ['Avatar', 'AvatarGroup'],
  import: "import { Avatar, AvatarGroup } from '@ui';",
  demos: [
    {
      id: 'sizes',
      title: 'Sizes',
      description:
        '`sm` (16px) is the list and inline default, `md` (24px) suits rows with more room, `lg` (40px) is for profile headers. `fill` takes the size of its container — give that container the dimensions.',
      render: SizesDemo,
    },
    {
      id: 'image-and-fallback',
      title: 'Image and fallback',
      description:
        'Render both children together. `Avatar.Image` covers the fallback while it loads cleanly, and hides itself if the source 404s so the fallback shows through instead of the browser’s broken-image glyph. Fallback text scales with the avatar size automatically.',
      render: ImageAndFallbackDemo,
    },
    {
      id: 'edge',
      title: 'Edge hairline',
      description:
        'A 1px inset ring — black on dark surfaces, white on light ones — so the avatar settles into the page rather than being outlined against it. It is inset, so it never changes the avatar’s footprint. Switch themes in the toolbar to see it follow the surface, and it is off by default — pass `highlightEdge` to draw it.',
      render: EdgeDemo,
    },
    {
      id: 'shape',
      title: 'Shape',
      description:
        '`rounded` is the default circle. `square` steps its corner radius with the size — `rounded-sm` at `sm` through `rounded-lg` at `lg` — so the corner stays proportional instead of looking sharp when small and soft when large.',
      render: ShapeDemo,
    },
    {
      id: 'group',
      title: 'Avatar group',
      description:
        '`AvatarGroup` overlaps its children and adds a separator ring sized to match. `AvatarGroup.Count` closes out the overflow. Pass the same `size` to the group and to every child.',
      render: GroupDemo,
    },
    {
      id: 'group-on-hover',
      title: 'Groups on a changing background',
      description:
        'The separator ring defaults to `--color-surface`. When the row behind it changes color, point `--avatar-group-separator` at the new background so the ring keeps disappearing into it.',
      render: GroupOnHoverDemo,
    },
  ],
  props: [
    {
      name: 'size',
      type: "'sm' | 'md' | 'lg' | 'fill'",
      default: "'sm'",
      description:
        'Diameter: 16px, 24px, 40px, or the container’s size. Also scales the fallback text and any child icon.',
    },
    {
      name: 'shape',
      type: "'rounded' | 'square'",
      default: "'rounded'",
      description:
        'Circle, or a square with a radius stepped to the size. Inherited by Avatar.Image.',
    },
    {
      name: 'highlightEdge',
      type: 'boolean',
      default: 'false',
      description:
        'Draws the 1px inset edge hairline on the root. Its outline paints over a covering image, so the image needs nothing of its own.',
    },
    {
      name: 'class',
      type: 'string',
      description: 'Extra classes on the avatar root.',
    },
  ],
  guidelines: {
    do: [
      'Set `size` and `shape` on the `Avatar` root — the slots inherit them, so the props do not need repeating on `Avatar.Image`.',
      'Always render an `Avatar.Fallback` beside `Avatar.Image` — it is what shows when the source 404s.',
      'Give `Avatar.Image` an `alt`, or `alt=""` when the name is already beside it.',
      'Match the `size` on `AvatarGroup`, every child `Avatar`, and `AvatarGroup.Count`.',
      'Override `--avatar-group-separator` when the background behind a group changes.',
    ],
    dont: [
      'Do not gate `Avatar.Image` behind a `Show` whose fallback is the `Avatar.Fallback` — that only covers a missing URL, not a broken one. Render both.',
      'Do not add a `ring-*` class to an Avatar — that slot belongs to AvatarGroup’s separator. The edge hairline is an outline for this reason.',
      'Do not use `size="fill"` without giving the parent a size; the avatar collapses.',
      'Do not hand-roll a circular image; the hairline and fallback behavior are the reason this component exists.',
    ],
  },
});
