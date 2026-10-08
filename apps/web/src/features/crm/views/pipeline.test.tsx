import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
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
vi.mock('@ui/components/DeleteDialog', () => ({ DeleteDialog: () => null }));

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

function setup() {
  render(() => (
    <PipelineView
      pipeline={pipeline}
      source={{
        pipelines: () => [pipeline],
        loading: () => false,
        error: () => false,
        refresh: async () => {},
        create: vi.fn(),
        rename: vi.fn(),
        trash: vi.fn(),
      }}
      Editor={() => <div role="grid" aria-label="Sales records" />}
      Sharing={() => <button>Share pipeline</button>}
      onCopyLink={() => {}}
      onTrashed={() => {}}
    />
  ));
}

afterEach(() => {
  cleanup();
  device.touch = true;
});

it('shows only the records below the workspace tabs on mobile', () => {
  setup();
  expect(screen.getByRole('grid', { name: 'Sales records' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Sales' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share pipeline' })).toBeNull();
});

it('keeps the title and sharing controls on desktop', () => {
  device.touch = false;
  setup();
  expect(screen.getByRole('heading', { name: 'Sales' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Share pipeline' })).toBeTruthy();
});
