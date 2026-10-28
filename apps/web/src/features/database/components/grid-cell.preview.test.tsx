import { createLivePreviewBatcher } from '@queries/preview/live-batcher';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, For, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import { type DatabaseMentionPickerProps, GridCell } from './grid-cell';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps the current company preview mounted while searching and cancelling its picker', async () => {
  let mounts = 0;
  let disposals = 0;
  let picker: DatabaseMentionPickerProps | undefined;
  const write = vi.fn(async () => true);
  function Preview() {
    mounts++;
    onCleanup(() => disposals++);
    return <span data-testid="company-preview">Northstar</span>;
  }
  render(() => (
    <GridCell
      column={{
        id: 'company',
        name: 'Company',
        dataType: 'ENTITY',
        specificEntityType: 'COMPANY',
        options: [],
        isMultiSelect: false,
        writable: true,
      }}
      value="company-1"
      canEdit
      onWrite={write}
      onAddOption={write}
      onMention={write}
      renderMentionValue={() => <Preview />}
      renderMentionPicker={(props) => {
        picker = props;
        return null;
      }}
    />
  ));
  const original = screen.getByTestId('company-preview');
  for (let round = 0; round < 2; round++) {
    const trigger = screen.getByRole('button', { name: 'Company: Northstar' });
    fireEvent.click(trigger);
    const editor = screen.getByRole('textbox', {
      name: 'Edit Company',
    }) as HTMLInputElement;
    expect(screen.getByTestId('company-preview')).toBe(original);
    expect(disposals).toBe(0);
    expect(editor.value).toBe('');
    expect(document.activeElement).toBe(editor);
    fireEvent.input(editor, { target: { value: 'new company' } });
    expect(picker?.search).toBe('new company');
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByTestId('company-preview')).toBe(original);
  }
  expect(mounts).toBe(1);
  expect(write).not.toHaveBeenCalled();
});

it('retains a company preview when refreshed row objects still reference the same company', () => {
  const column: DatabaseViewColumn = {
    id: 'company',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    options: [],
    isMultiSelect: false,
    writable: true,
  };
  const [row, setRow] = createSignal({ company: 'company-1' });
  let mounts = 0;
  let disposals = 0;
  function Preview(props: { id: string }) {
    mounts++;
    onCleanup(() => disposals++);
    return <span data-testid="company-preview">{props.id}</span>;
  }
  render(() => (
    <GridCell
      column={column}
      value={row().company}
      canEdit
      onWrite={vi.fn(async () => true)}
      onAddOption={vi.fn(async () => true)}
      renderMentionValue={(id) => <Preview id={id} />}
    />
  ));
  const original = screen.getByTestId('company-preview');
  expect(mounts).toBe(1);
  setRow({ company: 'company-1' });
  expect(screen.getByTestId('company-preview')).toBe(original);
  expect(mounts).toBe(1);
  expect(disposals).toBe(0);
  setRow({ company: 'company-2' });
  expect(screen.getByTestId('company-preview').textContent).toBe('company-2');
});

it('keeps multiple preview batches and duplicate references across row refreshes', () => {
  vi.useFakeTimers();
  const column: DatabaseViewColumn = {
    id: 'company',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    options: [],
    isMultiSelect: false,
    writable: true,
  };
  const initial = Array.from({ length: 123 }, (_, index) => ({
    company: `company-${index % 103}`,
  }));
  const [rows, setRows] = createSignal(initial);
  const start = vi.fn((items: string[]) => ({
    value: items,
    dispose: vi.fn(),
  }));
  const batcher = createLivePreviewBatcher({ start });
  let mounts = 0;
  function Preview(props: { id: string }) {
    mounts++;
    const [batch, setBatch] = createSignal<string[]>();
    const subscription = batcher.acquire(props.id, props.id, setBatch);
    onCleanup(subscription.dispose);
    return <span>{batch()?.includes(props.id) ? props.id : 'Loading...'}</span>;
  }
  render(() => (
    <For each={initial}>
      {(_, index) => (
        <GridCell
          column={column}
          value={rows()[index()].company}
          canEdit
          onWrite={vi.fn(async () => true)}
          onAddOption={vi.fn(async () => true)}
          renderMentionValue={(id) => <Preview id={id} />}
        />
      )}
    </For>
  ));
  vi.advanceTimersByTime(30);
  expect(start.mock.calls.map(([items]) => items.length)).toEqual([50, 50, 3]);
  for (let refresh = 0; refresh < 5; refresh++) {
    setRows((previous) => previous.map((row) => ({ ...row })));
    vi.advanceTimersByTime(30);
  }
  expect(start).toHaveBeenCalledTimes(3);
  expect(mounts).toBe(123);
});
