import { defineDoc } from '@app/features/ui-gallery/types';
import { For, lazy, Suspense } from 'solid-js';
import { Button } from './Button';
import { Input } from './Input';
import { InvertUtil } from './InvertUtil';
import { Layer } from './Layer';
import { UserMessageBubble } from './UserMessageBubble';

// Keep the renderer's app dependencies out of unrelated gallery pages.
const InvertedMarkdown = lazy(() => import('./invert-demo/InvertedMarkdown'));

function InvertedPaletteSamples() {
  return (
    <div class="flex flex-wrap gap-2">
      <For
        each={[
          'accent',
          'red',
          'orange',
          'amber',
          'yellow',
          'lime',
          'green',
          'teal',
          'cyan',
          'blue',
          'violet',
          'purple',
          'pink',
        ]}
      >
        {(color) => (
          <span
            class="rounded border border-edge-muted px-2 py-1 text-sm"
            style={{
              color: `var(--color-${color})`,
              'background-color': `var(--color-${color}-bg)`,
            }}
          >
            {color}
          </span>
        )}
      </For>
    </div>
  );
}

// #region demo:inverted
function InvertedDemo() {
  return (
    <div class="w-full rounded-lg bg-ink p-4">
      <InvertUtil>
        <div class="flex flex-col gap-3">
          <p>Inverted section</p>
          <p class="text-sm text-ink-muted">
            Text, borders, controls, and nested layers use the local palette.
          </p>
          <Input aria-label="Inverted input" placeholder="Write something…" />
          <div class="flex flex-wrap gap-2">
            <Button variant="ghost">Ghost</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="strong">Strong</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="cta">Primary action</Button>
            <Button variant="success">Success</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
          </div>
          <InvertedPaletteSamples />
          <Layer offset={1}>
            <div class="rounded-md border border-edge-muted bg-surface p-3 text-ink">
              Raised surface
            </div>
          </Layer>
          <InvertUtil>
            <div class="rounded-md bg-surface p-3 text-ink">
              A nested inversion restores the original foreground and
              background.
              <div class="mt-3 flex flex-col gap-3">
                <InvertedPaletteSamples />
                <Button variant="cta">Nested primary action</Button>
              </div>
            </div>
          </InvertUtil>
          <div class="min-w-0 border-t border-edge-muted pt-4">
            <Suspense>
              <InvertedMarkdown />
            </Suspense>
          </div>
        </div>
      </InvertUtil>
    </div>
  );
}
// #endregion

// #region demo:user-message
function UserMessageDemo() {
  return (
    <div class="w-full">
      <UserMessageBubble>
        <Suspense>
          <InvertedMarkdown />
        </Suspense>
      </UserMessageBubble>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'InvertUtil',
  category: 'Foundations',
  description:
    'Render existing components on an ink-colored background. InvertUtil scopes text, surfaces, borders, and palette lightness to the section without adding a layout box.',
  exports: ['InvertUtil'],
  import: "import { InvertUtil } from '@ui';",
  demos: [
    {
      id: 'user-message',
      title: 'User-sent AI message',
      description:
        'The shared chat and agent message bubble uses InvertUtil on an ink-colored surface in light themes, and Layer depth={3} for a slightly lighter surface in dark themes.',
      render: UserMessageDemo,
      fill: true,
      depth: 0,
    },
    {
      id: 'inverted',
      title: 'Inverted sections',
      description:
        'Place InvertUtil inside a bg-ink section, or wrap a bg-surface section in it. This example includes the app’s StaticMarkdown renderer with headings, nested lists, quotes, tables, and code. It starts at depth 0 and inherits theme changes. Portals outside the boundary keep the surrounding app palette.',
      render: InvertedDemo,
      fill: true,
      depth: 0,
    },
  ],
});
