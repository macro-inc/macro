import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { setViewportWidth } from '../../utils/utilBreakpoint';
import { MigrationPathSelector } from './MigrationPathSelector';

afterEach(cleanup);

function setup(width: number) {
  setViewportWidth(width);
  return render(() => (
    <MigrationPathSelector
      tabs={['Email', 'Files & data', 'Other tools'].map((label) => ({
        id: label.toLowerCase().replace(/[^a-z]+/g, '-'),
        label,
        content: <p>Steps for {label}</p>,
      }))}
    />
  ));
}

it('moves selection and focus together through desktop tabs', () => {
  const view = setup(1440);
  const first = view.getByRole('tab', { name: 'Email' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const notion = view.getByRole('tab', { name: 'Files & data' });
  expect(document.activeElement).toBe(notion);
  expect(notion.getAttribute('aria-selected')).toBe('true');
  expect(view.getByRole('tabpanel').textContent).toBe('Steps for Files & data');
  fireEvent.keyDown(notion, { key: 'End' });
  expect(document.activeElement).toBe(
    view.getByRole('tab', { name: 'Other tools' })
  );
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowLeft' });
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(first);
});

it.each([320, 390, 520, 700, 999])(
  'supports the compact menu at %ipx and restores focus',
  async (width) => {
    const view = setup(width);
    const trigger = view.getByRole('button', { name: 'Email' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await Promise.resolve();
    expect(document.activeElement).toBe(
      view.getByRole('menuitem', { name: 'Email' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    const notion = view.getByRole('menuitem', { name: 'Files & data' });
    expect(document.activeElement).toBe(notion);
    fireEvent.click(notion);
    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(
      view.getByRole('region', { name: 'Bring over Files & data' }).textContent
    ).toBe('Steps for Files & data');
    fireEvent.click(trigger);
    await Promise.resolve();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }
);

it('opens the last menu item with ArrowUp and closes when focus leaves', async () => {
  const view = setup(390);
  const trigger = view.getByRole('button', { name: 'Email' });
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  await Promise.resolve();
  const last = view.getByRole('menuitem', { name: 'Other tools' });
  expect(document.activeElement).toBe(last);
  expect(last.tabIndex).toBe(-1);
  fireEvent.focusOut(last, { relatedTarget: document.body });
  expect(view.queryByRole('menu')).toBeNull();
});
