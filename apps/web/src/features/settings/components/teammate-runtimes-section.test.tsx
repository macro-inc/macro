/**
 * @vitest-environment jsdom
 */

import type { Harness as RegisteredHarness } from '@service-storage/client';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeammateRuntimesSection } from './teammate-runtimes-section';

const VIEWER = 'macro|maya@example.com';

const mocks = vi.hoisted(() => ({
  directory: [] as RegisteredHarness[],
  pending: [] as string[],
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => VIEWER,
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useRunnableHarnessDirectoryQuery: () => ({
    isSuccess: true,
    get data() {
      return mocks.directory;
    },
  }),
  usePatchHarnessMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@entity/owner/owner-display', () => ({
  OwnerLabel: (props: { ownerId: string }) => (
    <span>{props.ownerId.replace('macro|', '')}</span>
  ),
}));

vi.mock('@app/features/access-requests/queries/source', () => ({
  createSharingSource: (entity: () => { entityId: string } | undefined) => ({
    state: () => ({
      mine: mocks.pending.includes(entity()?.entityId ?? '')
        ? { status: 'pending' }
        : undefined,
    }),
  }),
}));

vi.mock('@app/features/runtime-sharing/components/RuntimeAccessAction', () => ({
  RuntimeAccessAction: () => <button type="button">Request access</button>,
}));

function runtime(
  id: string,
  name: string,
  owner: string,
  overrides: Partial<RegisteredHarness> = {}
): RegisteredHarness {
  return {
    id,
    allow_permission_bypass: false,
    kind: 'macrod',
    name,
    owner: { type: 'user', user_id: owner },
    access: 'none',
    shared_team_ids: [],
    created_by: owner,
    created_at: '2026-08-27T12:00:00Z',
    updated_at: '2026-08-27T12:00:00Z',
    connected: true,
    last_connected_at: '2026-08-27T12:34:00Z',
    ...overrides,
  };
}

function row(name: string) {
  const element = screen
    .getByText(name)
    .closest<HTMLElement>('[data-teammate-runtime]');
  if (!element) throw new Error(`no row for ${name}`);
  return element;
}

beforeEach(() => {
  mocks.pending = [];
  mocks.directory = [
    runtime('00000000-0000-4000-8000-000000000001', 'Studio Mac', VIEWER, {
      access: 'owner',
    }),
    runtime(
      '00000000-0000-4000-8000-000000000002',
      'MacBook Pro',
      'macro|priya@example.com',
      {
        access: 'user',
        shared_team_ids: ['team-1'],
      }
    ),
    runtime(
      '00000000-0000-4000-8000-000000000003',
      'GPU workstation',
      'macro|priya@example.com',
      {
        connected: false,
      }
    ),
    runtime(
      '00000000-0000-4000-8000-000000000004',
      'Build server',
      'macro|theo@example.com',
      {
        access: 'read',
      }
    ),
    runtime(
      '00000000-0000-4000-8000-000000000005',
      'Linux desktop',
      'macro|lena@example.com'
    ),
  ];
});

describe('TeammateRuntimesSection', () => {
  it("groups teammates' runtimes by owner and leaves out the viewer's", () => {
    render(() => (
      <TeammateRuntimesSection canRemoveShared={false} onRemove={vi.fn()} />
    ));

    expect(screen.queryByText('Studio Mac')).toBeNull();
    const groups = [
      ...document.querySelectorAll('[data-teammate-runtime-owner]'),
    ].map((group) =>
      [...group.querySelectorAll('[data-teammate-runtime]')].map(
        (element) => element.getAttribute('data-teammate-runtime') ?? ''
      )
    );
    expect(groups).toEqual([
      ['MacBook Pro', 'GPU workstation'],
      ['Build server'],
      ['Linux desktop'],
    ]);
  });

  it('shows status and the viewer’s access, with Request access only when it helps', () => {
    mocks.pending = ['00000000-0000-4000-8000-000000000005'];
    render(() => (
      <TeammateRuntimesSection canRemoveShared={false} onRemove={vi.fn()} />
    ));

    expect(row('MacBook Pro').textContent).toContain(
      'Online · Your access: User'
    );
    expect(row('GPU workstation').textContent).toContain(
      'Offline · Your access: None'
    );
    expect(row('Build server').textContent).toContain('Your access: Read');
    expect(row('Linux desktop').textContent).toContain(
      'Your access: Requested'
    );
    expect(row('MacBook Pro').textContent).not.toContain('Request access');
    expect(row('Build server').textContent).toContain('Request access');
  });

  it('lets the team owner remove a team machine', () => {
    const onRemove = vi.fn();
    render(() => (
      <TeammateRuntimesSection canRemoveShared onRemove={onRemove} />
    ));

    expect(row('GPU workstation').textContent).not.toContain('Remove');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: '00000000-0000-4000-8000-000000000002' })
    );
  });

  it('shows nothing without teammates’ runtimes', () => {
    mocks.directory = [
      runtime('00000000-0000-4000-8000-000000000001', 'Studio Mac', VIEWER),
    ];
    render(() => (
      <TeammateRuntimesSection canRemoveShared={false} onRemove={vi.fn()} />
    ));

    expect(
      screen.queryByRole('heading', { name: "Teammates' machines" })
    ).toBeNull();
  });
});
