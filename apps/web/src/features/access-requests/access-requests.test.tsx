import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentAccessDenied } from './access-requests';
import type { SharingSource } from './context/contracts';
import { fakeSharingSource } from './tests/source';
import { PermissionRequestsView } from './views/PermissionRequestsView';
import { RequestAccessView } from './views/RequestAccessView';

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/component/AccessErrorViews/Unauthorized', () => ({
  default: (props: ParentProps) => <div>{props.children}</div>,
}));
vi.mock('@entity/owner/owner-display', () => ({
  OwnerLabel: (props: { ownerId: string }) => <span>{props.ownerId}</span>,
}));
vi.mock('@ui', () => ({
  Button: (props: {
    children: JSX.Element;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
}));
vi.mock('./components/AccessLevelSelect', () => ({
  AccessLevelSelect: (props: {
    value: string;
    label: string;
    onChange(level: 'comment'): void;
  }) => (
    <button aria-label={props.label} onClick={() => props.onChange('comment')}>
      {props.value}
    </button>
  ),
}));
let source: SharingSource;
vi.mock('./queries/source', () => ({ createSharingSource: () => source }));
afterEach(cleanup);

it.each(['pending', 'cancelled', 'denied'] as const)(
  'labels the %s retry deadline without misreporting a denial',
  (status) => {
    const mine = {
      id: 'request',
      requesterId: 'requester',
      requestedLevel: 'edit' as const,
      status,
      revision: 1,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
      retryAfter: new Date(Date.now() + 60_000).toISOString(),
    };
    const { source } = fakeSharingSource({ mine });
    const view = render(() => (
      <RequestAccessView
        source={source}
        allowedLevels={['view', 'comment', 'edit']}
      />
    ));
    if (status === 'denied')
      expect(view.getByText(/Request denied/)).toBeTruthy();
    else {
      expect(view.queryByText(/Request denied/)).toBeNull();
      expect(view.getByText(/You can send another request/)).toBeTruthy();
    }
    expect(
      view
        .getByRole('button', {
          name: status === 'pending' ? 'Request sent' : 'Request access',
        })
        .hasAttribute('disabled')
    ).toBe(true);
    if (status === 'pending')
      expect(
        view
          .getByRole('button', { name: 'Cancel request' })
          .hasAttribute('disabled')
      ).toBe(false);
  }
);

it('lets a reviewer approve a request from the denied document screen without opening the file', () => {
  const request = {
    id: 'request',
    requesterId: 'macro|requester@macro.com',
    requestedLevel: 'view' as const,
    status: 'pending' as const,
    revision: 1,
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  };
  source = fakeSharingSource({
    canReview: true,
    accessLevel: null,
    requests: [request],
    pendingCount: 1,
  }).source;
  const onAccessGranted = vi.fn();
  const view = render(() => (
    <DocumentAccessDenied
      documentId="01a140ad-06d5-7791-8b68-bc128654bbba"
      onAccessGranted={onAccessGranted}
    />
  ));
  expect(
    view.getByRole('region', { name: 'Permission requests' })
  ).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request access' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Grant access' }));
  expect(source.resolve).toHaveBeenCalledWith(request, 'view');
  expect(onAccessGranted).not.toHaveBeenCalled();
});

it('preserves a reviewer’s selected grant level through a background request refresh', () => {
  const request = {
    id: 'request',
    requesterId: 'macro|requester@macro.com',
    requestedLevel: 'edit' as const,
    status: 'pending' as const,
    revision: 1,
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  };
  const { source: review, setState } = fakeSharingSource({
    canReview: true,
    requests: [request],
    pendingCount: 1,
  });
  const view = render(() => <PermissionRequestsView source={review} />);
  fireEvent.click(view.getByRole('button', { name: 'Access to grant' }));
  expect(
    view.getByRole('button', { name: 'Access to grant' }).textContent
  ).toBe('comment');
  setState((current) => ({ ...current, requests: [{ ...request }] }));
  expect(
    view.getByRole('button', { name: 'Access to grant' }).textContent
  ).toBe('comment');
  fireEvent.click(view.getByRole('button', { name: 'Grant access' }));
  expect(review.resolve).toHaveBeenCalledWith(request, 'comment');
});
