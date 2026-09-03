import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

function renderAvatar(onError?: (event: Event) => void) {
  const result = render(() => (
    <Avatar size="lg">
      <Avatar.Image src="/portrait.png" alt="Teo" onError={onError} />
      <Avatar.Fallback>TC</Avatar.Fallback>
    </Avatar>
  ));
  const image = result.container.querySelector('img');
  if (!image) throw new Error('avatar image did not render');
  return { ...result, image };
}

describe('Avatar', () => {
  it('leaves the edge hairline off by default', () => {
    const { container } = render(() => (
      <Avatar size="lg">
        <Avatar.Fallback>TC</Avatar.Fallback>
      </Avatar>
    ));
    const root = container.querySelector('[data-slot="avatar"]');
    expect(root?.className).not.toContain('avatar-edge');
  });

  it('draws the hairline with highlightEdge', () => {
    const { container } = render(() => (
      <Avatar size="lg" highlightEdge>
        <Avatar.Fallback>TC</Avatar.Fallback>
      </Avatar>
    ));
    const root = container.querySelector('[data-slot="avatar"]');
    expect(root?.className).toContain('avatar-edge');
  });

  it('is a circle by default and steps the radius when square', () => {
    const { container } = render(() => (
      <>
        <Avatar size="lg" data-testid="circle">
          <Avatar.Fallback>TC</Avatar.Fallback>
        </Avatar>
        <Avatar size="lg" shape="square" data-testid="square">
          <Avatar.Fallback>TC</Avatar.Fallback>
        </Avatar>
        <Avatar size="sm" shape="square" data-testid="square-sm">
          <Avatar.Fallback>TC</Avatar.Fallback>
        </Avatar>
      </>
    ));
    const at = (id: string) =>
      container.querySelector(`[data-testid="${id}"]`)?.className ?? '';

    expect(at('circle')).toContain('rounded-full');
    expect(at('square')).toContain('rounded-lg');
    expect(at('square')).not.toContain('rounded-full');
    expect(at('square-sm')).toContain('rounded-sm');
  });
});

describe('Avatar.Image', () => {
  it('shows the image while it loads cleanly', () => {
    const { image } = renderAvatar();
    expect(image.hasAttribute('data-failed')).toBe(false);
    expect(image.className).not.toContain('hidden');
  });

  // Without this the browser paints its broken-image glyph over the fallback.
  it('hides itself when the source fails so the fallback shows through', () => {
    const { image, container } = renderAvatar();
    image.dispatchEvent(new Event('error'));

    expect(image.hasAttribute('data-failed')).toBe(true);
    expect(image.className).toContain('hidden');
    expect(container.textContent).toContain('TC');
  });

  it('still calls a caller onError handler', () => {
    const onError = vi.fn();
    const { image } = renderAvatar(onError);
    image.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // UserIcon and BotIcon retry by reassigning currentTarget.src inside onError,
  // so the element has to stay mounted and recover when the retry loads.
  it('recovers when a retried source loads', () => {
    const { image } = renderAvatar((event) => {
      (event.currentTarget as HTMLImageElement).src = '/original.png';
    });

    image.dispatchEvent(new Event('error'));
    expect(image.hasAttribute('data-failed')).toBe(true);
    expect(image.isConnected).toBe(true);

    image.dispatchEvent(new Event('load'));
    expect(image.hasAttribute('data-failed')).toBe(false);
    expect(image.className).not.toContain('hidden');
  });

  // The root is a centered flex row. An in-flow image would share that row with
  // a sibling Avatar.Fallback and squeeze both; it has to stack over it.
  it('stacks over a sibling fallback instead of sharing the flex row', () => {
    const { image, container } = renderAvatar();
    expect(image.className).toContain('absolute');
    expect(container.textContent).toContain('TC');
  });

  it('inherits shape from the enclosing Avatar', () => {
    const { container } = render(() => (
      <Avatar size="lg" shape="square">
        <Avatar.Image src="/portrait.png" alt="Teo" />
      </Avatar>
    ));
    expect(container.querySelector('img')?.className).toContain('rounded-lg');
  });

  // The edge is an outline on the root, which paints over this image. A second
  // outline here would sit in the same 1px and double the alpha.
  it('does not draw an edge of its own', () => {
    const { container } = render(() => (
      <Avatar size="lg" highlightEdge>
        <Avatar.Image src="/portrait.png" alt="Teo" />
      </Avatar>
    ));
    expect(container.querySelector('img')?.className).not.toContain(
      'avatar-edge'
    );
    expect(
      container.querySelector('[data-slot="avatar"]')?.className
    ).toContain('avatar-edge');
  });

  it('takes its own props over the inherited ones', () => {
    const { container } = render(() => (
      <Avatar size="lg" shape="square">
        <Avatar.Image src="/portrait.png" alt="Teo" shape="rounded" />
      </Avatar>
    ));
    expect(container.querySelector('img')?.className).toContain('rounded-full');
  });
});
