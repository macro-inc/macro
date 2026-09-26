import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { projectRouteId } from './core/route';
import { ProjectAttachment } from './project-attachment';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  query: {} as Record<string, unknown>,
  enabled: (): boolean => true,
  mountQuery: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  ShowFeatureFlag: (props: ParentProps) => (
    <Show when={mocks.enabled()}>{props.children}</Show>
  ),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableProjects: { key: 'enable-projects', override: undefined },
  isFeatureEnabled: () => mocks.enabled(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.open }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('./queries/project-identity', () => ({
  useProjectIdentityQuery: () => {
    mocks.mountQuery();
    return mocks.query;
  },
}));
beforeEach(() => {
  mocks.enabled = () => true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens an authorized attachment using native project identity and split preference', () => {
  mocks.query = {
    isPending: false,
    isError: false,
    isSuccess: true,
    data: {
      id: 'initiative-1',
      name: 'Launch',
      description_document_id: 'never-open-this',
    },
  };
  render(() => <ProjectAttachment id="initiative-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }), {
    shiftKey: true,
  });
  expect(mocks.open).toHaveBeenCalledWith(
    {
      type: 'component',
      id: projectRouteId({ id: 'initiative-1', section: 'overview' }),
    },
    { preferNewSplit: true }
  );
});

it('hides stale names and links when current access fails', () => {
  const [denied, setDenied] = createSignal(false);
  mocks.query = {
    isPending: false,
    get isError() {
      return denied();
    },
    get isSuccess() {
      return !denied();
    },
    data: { id: 'initiative-1', name: 'Private launch' },
  };
  render(() => <ProjectAttachment id="initiative-1" />);
  expect(screen.getByRole('button', { name: 'Private launch' })).toBeTruthy();
  setDenied(true);
  expect(screen.queryByText('Private launch')).toBeNull();
  expect(screen.getByText('Unavailable project')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

it('does not read pending query data', () => {
  mocks.query = {
    isPending: true,
    get data() {
      throw new Error('suspending resource read');
    },
  };
  render(() => <ProjectAttachment id="initiative-1" />);
  expect(screen.getByText('Loading project…')).toBeTruthy();
});

it('does not mount project queries while off and removes links when the flag turns off', () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.enabled = enabled;
  mocks.query = {
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { id: 'initiative-1', name: 'Launch' },
  };
  render(() => <ProjectAttachment id="initiative-1" />);
  expect(mocks.mountQuery).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
  setEnabled(true);
  expect(mocks.mountQuery).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();
  setEnabled(false);
  expect(screen.queryByRole('button')).toBeNull();
});
