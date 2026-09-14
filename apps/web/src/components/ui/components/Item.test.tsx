import { fireEvent, render } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { Card } from './Card';
import { Item } from './Item';

it('renders a first-line icon slot without hiding interactive children', () => {
  const onClick = vi.fn();
  const view = render(() => (
    <Item>
      <Item.Icon aria-label="Status">
        <button type="button" onClick={onClick}>
          Change status
        </button>
      </Item.Icon>
      <Item.Content>
        <Item.Title>Task title</Item.Title>
        <Item.Description>Author - Today</Item.Description>
      </Item.Content>
    </Item>
  ));
  const icon = view.container.querySelector('[data-slot="item-icon"]');
  expect(icon?.tagName).toBe('SPAN');
  expect(icon?.classList.contains('inline-flex')).toBe(true);
  expect(icon?.classList.contains('self-start')).toBe(true);
  expect(icon?.getAttribute('aria-hidden')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Change status' }));
  expect(onClick).toHaveBeenCalledOnce();
  view.unmount();
});

it('shares the icon with Card and allows explicit size overrides', () => {
  expect(Card.Icon).toBe(Item.Icon);
  const view = render(() => <Card.Icon class="h-7" aria-hidden="true" />);
  const icon = view.container.querySelector('[data-slot="item-icon"]');
  expect(icon?.classList.contains('h-7')).toBe(true);
  expect(icon?.classList.contains('h-5')).toBe(false);
  view.unmount();
});

it('top-aligns media by default and supports a centered override', () => {
  const view = render(() => (
    <>
      <Item.Media />
      <Item.Media class="self-center" />
    </>
  ));
  const media = view.container.querySelectorAll('[data-slot="item-media"]');
  expect(media[0].classList.contains('self-start')).toBe(true);
  expect(media[1].classList.contains('self-center')).toBe(true);
  expect(media[1].classList.contains('self-start')).toBe(false);
  view.unmount();
});
