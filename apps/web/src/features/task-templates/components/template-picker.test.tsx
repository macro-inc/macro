/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TemplateDropdown } from './template-picker';

vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
afterEach(cleanup);

it('keeps retry reachable by menu keyboard navigation without dismissing the picker', () => {
  const retry = vi.fn();
  render(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <TemplateDropdown
        open={open()}
        onOpenChange={setOpen}
        disabled={false}
        loading={false}
        error
        items={[]}
        selectedKey="none"
        selectedLabel="No template"
        onSelectNone={vi.fn()}
        onNew={vi.fn()}
        onRetry={retry}
      />
    );
  });
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  const retryAction = screen.getByText('create.taskTemplateRetry');
  expect(document.activeElement).toBe(retryAction);
  fireEvent.keyDown(retryAction, { key: 'Enter' });
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole('menu')).toBeTruthy();
});

it('searches saved templates while retaining the creation action', () => {
  const select = vi.fn();
  const create = vi.fn();
  render(() => (
    <TemplateDropdown
      open
      onOpenChange={vi.fn()}
      disabled={false}
      loading={false}
      error={false}
      items={[
        { key: 'checklist', label: 'Checklist', shared: true, select },
        { key: 'issue', label: 'Issue report', shared: false, select: vi.fn() },
      ]}
      selectedKey="none"
      selectedLabel="No template"
      onSelectNone={vi.fn()}
      onNew={create}
      onRetry={vi.fn()}
    />
  ));
  fireEvent.input(screen.getByRole('textbox'), { target: { value: 'CHECK' } });
  expect(
    screen.queryByRole('menuitemradio', { name: 'Issue report' })
  ).toBeNull();
  const choice = screen.getByRole('menuitemradio', { name: 'Checklist' });
  choice.focus();
  fireEvent.keyDown(choice, { key: 'Enter' });
  expect(select).toHaveBeenCalledOnce();
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'not found' },
  });
  const createAction = screen.getByRole('menuitemradio', {
    name: 'create.taskTemplateNew',
  });
  createAction.focus();
  fireEvent.keyDown(createAction, { key: 'Enter' });
  expect(create).toHaveBeenCalledOnce();
});
