import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Pipeline } from '../core/pipeline';
import { PipelineView } from './pipeline';

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@core/component/InlineTitleEditor', () => ({
  InlineTitleEditor: (props: { value: string; ariaLabel: string }) => (
    <input aria-label={props.ariaLabel} value={props.value} />
  ),
}));
vi.mock('@ui/components/DeleteDialog', () => ({
  DeleteDialog: (props: {
    open: boolean;
    onDelete(): void;
    onOpenChange(open: boolean): void;
  }) => (
    <Show when={props.open}>
      <div role="alertdialog" aria-label="Trash pipeline?">
        <button onClick={props.onDelete}>Confirm trash</button>
        <button onClick={() => props.onOpenChange(false)}>Cancel trash</button>
      </div>
    </Show>
  ),
}));

const pipeline: Pipeline = {
  id: 'pipeline',
  name: 'Sales',
  teamId: 'team',
  userId: 'owner',
  recordType: 'company',
  databaseId: 'database',
  tableId: 'table',
  primaryColumnId: 'company',
  sharing: 'private',
  grant: 'view',
  createdAt: '',
  trashedAt: null,
};

function setup(grant: Pipeline['grant'] = 'view') {
  const currentPipeline = { ...pipeline, grant };
  const rename = vi.fn(async (_id: string, _name: string) => {});
  const trash = vi.fn(async (_id: string) => {});
  const copyLink = vi.fn();
  const onTrashed = vi.fn();
  render(() => (
    <PipelineView
      pipeline={currentPipeline}
      source={{
        pipelines: () => [pipeline],
        loading: () => false,
        error: () => false,
        refresh: async () => {},
        create: vi.fn(),
        rename,
        trash,
      }}
      Editor={(props) => (
        <>
          {props.actions}
          <div role="grid" aria-label="Sales records" />
        </>
      )}
      Sharing={(props) => (
        <button
          aria-label={`Share ${props.pipeline.name}`}
          onClick={props.onCopyLink}
        >
          Share pipeline
        </button>
      )}
      onCopyLink={copyLink}
      onTrashed={onTrashed}
    />
  ));
  return { rename, trash, copyLink, onTrashed };
}

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  motionStyles = document.createElement('style');
  // jsdom does not load the app's dialog transition styles.
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  device.touch = true;
  vi.restoreAllMocks();
});

it('keeps mobile pipeline controls in a compact action sheet without the title row', () => {
  setup();
  expect(screen.getByRole('grid', { name: 'Sales records' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Sales' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share Sales' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pipeline actions' }));
  expect(screen.getByRole('dialog', { name: 'Pipeline actions' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Share Sales' })).toBeTruthy();
});

it.each(['view', 'comment', 'edit', 'owner'] as const)(
  'respects the %s grant in mobile actions',
  (grant) => {
    const { copyLink } = setup(grant);
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline actions' }));
    const sheet = within(
      screen.getByRole('dialog', { name: 'Pipeline actions' })
    );
    expect(!!sheet.queryByRole('button', { name: 'Rename pipeline' })).toBe(
      grant === 'edit' || grant === 'owner'
    );
    expect(!!sheet.queryByRole('button', { name: 'Trash pipeline' })).toBe(
      grant === 'owner'
    );
    fireEvent.click(sheet.getByRole('button', { name: 'Share Sales' }));
    expect(copyLink).toHaveBeenCalledOnce();
  }
);

it('renames from mobile and keeps a failed attempt open for retry', async () => {
  const { rename } = setup('edit');
  rename.mockRejectedValueOnce(new Error('Request failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Pipeline actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename pipeline' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Pipeline name' }), {
    target: { value: '  Renewals  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Could not save')
  );
  expect(
    (screen.getByRole('textbox', { name: 'Pipeline name' }) as HTMLInputElement)
      .value
  ).toBe('  Renewals  ');
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenLastCalledWith('pipeline', 'Renewals');
});

it('requires confirmation before trashing a pipeline from mobile', async () => {
  const { trash, onTrashed } = setup('owner');
  fireEvent.click(screen.getByRole('button', { name: 'Pipeline actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trash pipeline' }));
  expect(
    screen.getByRole('alertdialog', { name: 'Trash pipeline?' })
  ).toBeTruthy();
  expect(trash).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm trash' }));
  await waitFor(() => expect(onTrashed).toHaveBeenCalledOnce());
  expect(trash).toHaveBeenCalledExactlyOnceWith('pipeline');
});

it('keeps the title and sharing controls on desktop', () => {
  device.touch = false;
  setup();
  expect(screen.getByRole('heading', { name: 'Sales' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Share Sales' })).toBeTruthy();
});
