import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import WideHome from '~icons/macro/wide-home';
import Plus from '~icons/ph/plus';

describe('unplugin-icons', () => {
  afterEach(cleanup);

  it('compiles phosphor plus at the default 1.2em scale without a size class', () => {
    const { container } = render(() => <Plus />);
    const svg = container.querySelector('svg');

    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('1.2em');
    expect(svg?.getAttribute('height')).toBe('1.2em');
    expect(svg?.getAttribute('class') ?? '').not.toMatch(/(^|\s)size-/);
  });

  it('compiles wide-home after stripping the HTML comment', () => {
    const { container } = render(() => <WideHome />);
    const svg = container.querySelector('svg');

    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('1.2em');
    expect(svg?.getAttribute('height')).toBe('1.2em');
    expect(container.innerHTML).not.toContain('<!--');
  });
});
