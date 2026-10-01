import { render } from 'solid-js/web';
import { expect, it } from 'vitest';
import { createTextMeasurer } from '../src/browser';
import type { ShapeItem } from '../src/core';
import { TextView } from '../src/solid';

const item: ShapeItem<'text'> = {
  id: 'text',
  type: 'text',
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: [1, 0, 0, 1, 0, 0],
  appearance: { fill: 'transparent', stroke: 'black' },
  geometry: {
    content: '<img src=x onerror=alert(1)>\n{not-json}',
    width: 200,
    height: 32,
    autoWidth: false,
    fontSize: 24,
    fontFamily: 'sans',
  },
};

it('renders and measures plain strings safely without parsing markup or editor JSON', () => {
  const host = document.createElement('div');
  const dispose = render(() => <TextView item={item} scale={1} />, host);
  const measurer = createTextMeasurer();
  try {
    expect(host.textContent).toBe(item.geometry.content);
    expect(host.querySelector('img')).toBeNull();
    measurer.measure(item.geometry);
    const measured = document.body.querySelector('.graphics-rich-text');
    expect(measured?.textContent).toBe(item.geometry.content);
    expect(measured?.querySelector('img')).toBeNull();
  } finally {
    dispose();
    measurer.dispose();
  }
});

it('passes encoded content verbatim to the host renderer', () => {
  const host = document.createElement('div');
  const dispose = render(
    () => (
      <TextView
        item={item}
        scale={1}
        contentView={(props) => (
          <span data-payload={props.content}>Host rendering</span>
        )}
      />
    ),
    host
  );
  try {
    expect(host.textContent).toBe('Host rendering');
    expect(host.querySelector('span')?.getAttribute('data-payload')).toBe(
      item.geometry.content
    );
  } finally {
    dispose();
  }
});
