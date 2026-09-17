/** @vitest-environment jsdom */
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { ViewSidebar } from './ViewSidebar';

it('expands a tree branch without selecting its destination', () => {
  const select = vi.fn();
  const [expanded, setExpanded] = createSignal(false);
  const view = render(() => (
    <ViewSidebar.TreeItem
      label="Project"
      expanded={expanded()}
      onToggle={() => setExpanded((value) => !value)}
      onClick={select}
    >
      <span>Project</span>
    </ViewSidebar.TreeItem>
  ));
  fireEvent.click(view.getByRole('button', { name: 'Expand Project' }));
  expect(expanded()).toBe(true);
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Project' }));
  expect(select).toHaveBeenCalledOnce();
  expect(expanded()).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Collapse Project' }));
  expect(expanded()).toBe(false);
  expect(select).toHaveBeenCalledOnce();
});

it('keeps disabled destinations inert and supports explicit tree semantics', () => {
  const select = vi.fn();
  const view = render(() => (
    <>
      <ViewSidebar.Item disabled onClick={select}>
        Unavailable
      </ViewSidebar.Item>
      <ViewSidebar.Item as="div" role="treeitem" active aria-current="true">
        Channel
      </ViewSidebar.Item>
    </>
  ));
  const disabled = view.getByRole('button', { name: 'Unavailable' });
  expect(disabled.hasAttribute('disabled')).toBe(true);
  disabled.click();
  expect(select).not.toHaveBeenCalled();
  const channel = view.getByRole('treeitem', { name: 'Channel' });
  expect(channel.tagName).toBe('DIV');
  expect(channel.getAttribute('aria-current')).toBe('true');
});
