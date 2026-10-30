import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import {
  readEntityAccessRequestHandler,
  requestEntityAccessHandler,
} from './AccessRequests';
import { ToolErrorContext } from './ToolRenderer';

vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => (
    <span data-testid="item" data-type={props.type}>
      {props.id}
    </span>
  ),
}));
afterEach(cleanup);
const id = '0195d721-1730-7cda-a72e-855bec53411e';
const context = {
  chat_id: 'chat',
  message_id: 'message',
  part_index: 0,
  isComplete: true,
  renderContext: { isStreaming: false, followedBy: () => false },
};

it('shows a sent request as pending, not as access gained', () => {
  const view = render(() => (
    <requestEntityAccessHandler.render
      {...context}
      tool={{
        id,
        name: 'RequestEntityAccess',
        data: { entityType: 'initiative', entityId: id, access: 'edit' },
      }}
      response={{
        id,
        name: 'RequestEntityAccess',
        data: {
          status: 'pending',
          requestedLevel: 'edit',
          sentTo: ['macro|owner@example.com'],
          requestedAt: '2026-10-30T12:00:00Z',
        },
      }}
    />
  ));
  expect(view.container.textContent).toContain('Requested edit access to');
  expect(view.container.textContent).toContain('pending');
  expect(view.getByTestId('item').dataset.type).toBe('initiative');
});

it('says a refused request was not sent', () => {
  const view = render(() => (
    <ToolErrorContext.Provider
      value={() => ({ kind: 'failed', reason: 'cooldown' })}
    >
      <requestEntityAccessHandler.render
        {...context}
        tool={{
          id,
          name: 'RequestEntityAccess',
          data: { entityType: 'email_thread', entityId: id, access: 'view' },
        }}
      />
    </ToolErrorContext.Provider>
  ));
  expect(view.container.textContent).toContain('Could not request view access');
  expect(view.getByTestId('item').dataset.type).toBe('email');
});

it('reports the outcome of the latest request', () => {
  const view = render(() => (
    <readEntityAccessRequestHandler.render
      {...context}
      tool={{
        id,
        name: 'ReadEntityAccessRequest',
        data: { entityType: 'external_chat', entityId: id },
      }}
      response={{
        id,
        name: 'ReadEntityAccessRequest',
        data: {
          currentAccess: 'edit',
          supportedLevels: ['view'],
          owner: null,
          request: {
            status: 'granted',
            requestedLevel: 'edit',
            grantedLevel: 'edit',
            updatedAt: '2026-10-30T12:00:00Z',
            retryAfter: null,
          },
        },
      }}
    />
  ));
  expect(view.container.textContent).toContain(
    'Checked access to an item · edit request granted'
  );
  expect(view.queryByTestId('item')).toBeNull();
});
