import { TraceFlow, useFlow } from '@app/observability/flow';
import { initializeUiOperationTelemetry } from '@app/observability/ui-operation';
import { ThrownResultError } from '@core/util/result';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({ pageView: vi.fn(), track: vi.fn() }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => analytics,
}));
vi.mock('@components/app/side-panel', () => ({}));
vi.mock('@core/mobile/native-network-status', () => ({
  nativeNetworkStatus: () => 'online',
}));
vi.mock('@core/component/AccessErrorViews/Unauthorized', () => ({
  default: () => null,
}));
vi.mock('@core/component/AccessErrorViews/NotFound', () => ({
  default: () => null,
}));
vi.mock('@core/component/AccessErrorViews/Gone', () => ({
  default: () => null,
}));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
let notifyAccess: ((level: AccessLevel | null) => void) | undefined;
vi.mock('@app/features/access-requests/access-requests', () => ({
  useSharedAccessUpdates: (
    _entity: unknown,
    apply: (level: AccessLevel | null) => void
  ): Accessor<AccessLevel | null | undefined> => {
    const [access, setAccess] = createSignal<AccessLevel | null>();
    notifyAccess = (level) => {
      setAccess(level);
      apply(level);
    };
    return access;
  },
  DocumentAccessDenied: (props: {
    documentId: string;
    onAccessGranted: () => void;
  }) => (
    <button data-document-id={props.documentId} onClick={props.onAccessGranted}>
      Request access
    </button>
  ),
}));
vi.mock('@ui', () => ({
  Button: (props: { children: JSX.Element; onClick?: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));

import { FileDetailLoadGate } from './FileDetail';

let dispose: (() => void) | undefined;
let disposeTelemetry: (() => void) | undefined;
beforeEach(() => {
  disposeTelemetry = initializeUiOperationTelemetry();
});
afterEach(() => {
  analytics.track.mockClear();
  dispose?.();
  disposeTelemetry?.();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

type Loaded = {
  userAccessLevel: AccessLevel;
  source?: { cleanup: () => void };
};
function mount(
  load: (id: string) => Promise<Loaded>,
  cleanupEditor?: () => void
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <FileDetailLoadGate
        documentId="private-document"
        entityType="md"
        label="document"
        load={load}
        dispose={(data) => data.source?.cleanup()}
      >
        {(data) => {
          onCleanup(() => cleanupEditor?.());
          return <div>Document content: {data.userAccessLevel}</div>;
        }}
      </FileDetailLoadGate>
    ),
    container
  );
  return container;
}

describe('file access errors', () => {
  it.each(['UNAUTHORIZED', 'FORBIDDEN'])(
    'offers a request for %s and reloads after a grant',
    async (code) => {
      const load = vi
        .fn<() => Promise<Loaded>>()
        .mockRejectedValueOnce(
          new ThrownResultError([{ code, message: 'Unauthorized access' }])
        )
        .mockResolvedValue({ userAccessLevel: 'view' });
      const container = mount(load);
      await vi.waitFor(() =>
        expect(container.textContent).toContain('Request access')
      );
      expect(container.textContent).not.toContain('couldn’t be displayed');
      container
        .querySelector<HTMLButtonElement>(
          '[data-document-id="private-document"]'
        )!
        .click();
      await vi.waitFor(() =>
        expect(container.textContent).toContain('Document content')
      );
      expect(load).toHaveBeenCalledTimes(2);
    }
  );

  it('reloads an open document after an upgrade and disposes revoked content before regrant', async () => {
    const cleanupEditor = vi.fn();
    const load = vi
      .fn<() => Promise<Loaded>>()
      .mockResolvedValueOnce({ userAccessLevel: 'view' })
      .mockResolvedValueOnce({ userAccessLevel: 'edit' })
      .mockResolvedValue({ userAccessLevel: 'view' });
    const container = mount(load, cleanupEditor);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Document content: view')
    );
    notifyAccess?.('view');
    expect(load).toHaveBeenCalledTimes(1);
    expect(cleanupEditor).not.toHaveBeenCalled();
    notifyAccess?.('edit');
    expect(cleanupEditor).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Document content: edit')
    );
    notifyAccess?.(null);
    expect(container.textContent).toContain('Request access');
    expect(container.textContent).not.toContain('Document content');
    expect(cleanupEditor).toHaveBeenCalledTimes(2);
    notifyAccess?.('view');
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Document content: view')
    );
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('restarts a pending load when access is confirmed during it', async () => {
    const pending = Promise.withResolvers<Loaded>();
    const load = vi
      .fn<() => Promise<Loaded>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ userAccessLevel: 'view' });
    const container = mount(load);
    // The access poll answers in a later task than the one that started the load.
    await new Promise((resolve) => setTimeout(resolve));

    notifyAccess?.('view');
    pending.resolve({ userAccessLevel: 'edit' });
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Document content: view')
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('counts an open once the document loads, not on access reloads', async () => {
    const load = vi
      .fn<() => Promise<Loaded>>()
      .mockResolvedValueOnce({ userAccessLevel: 'view' })
      .mockResolvedValue({ userAccessLevel: 'edit' });
    const container = mount(load);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Document content: view')
    );
    notifyAccess?.('edit');
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Document content: edit')
    );

    expect(analytics.track.mock.calls).toEqual([
      ['open_entity', { entityType: 'md', entityId: 'private-document' }],
    ]);
  });

  it('counts no open for a document that failed to load', async () => {
    const container = mount(async () => {
      throw new ThrownResultError([{ code: 'NOT_FOUND', message: 'Missing' }]);
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Try again')
    );

    expect(analytics.track).not.toHaveBeenCalled();
  });

  it.each(['NETWORK_ERROR', 'NOT_FOUND', 'GONE'])(
    'keeps %s separate from denied access',
    async (code) => {
      const container = mount(async () => {
        throw new ThrownResultError([{ code, message: 'Request failed' }]);
      });
      await vi.waitFor(() =>
        expect(container.textContent).toContain('Try again')
      );
      expect(container.textContent).not.toContain('Request access');
    }
  );
});

it('holds the view flow while the shared document resource loads', async () => {
  const pending = Promise.withResolvers<Loaded>();
  const published = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const ready = vi.fn(() => settled.resolve());
  function ObserveReady() {
    const span = useFlow().span;
    const setAttr = span.setAttr.bind(span);
    vi.spyOn(span, 'setAttr').mockImplementation((key, value) => {
      setAttr(key, value);
      if (key === 'ui.work_to_ready_ms') ready();
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <TraceFlow name="view.document">
        <ObserveReady />
        <FileDetailLoadGate
          documentId="document"
          entityType="md"
          label="document"
          load={() => pending.promise}
        >
          {() => {
            published.resolve();
            return <div>Loaded</div>;
          }}
        </FileDetailLoadGate>
      </TraceFlow>
    ),
    container
  );
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  pending.resolve({ userAccessLevel: 'owner' });
  await published.promise;
  await settled.promise;
  expect(ready).toHaveBeenCalledOnce();
});

it('cleans up a sync source returned after its view is disposed', async () => {
  const pending = Promise.withResolvers<Loaded>();
  const cleanupSource = vi.fn();
  const loaded = {
    userAccessLevel: 'view' as const,
    source: { cleanup: cleanupSource },
  };
  mount(() => pending.promise);
  dispose?.();
  dispose = undefined;
  pending.resolve(loaded);
  await pending.promise;
  await Promise.resolve();
  expect(cleanupSource).toHaveBeenCalledOnce();
});

it('reauthorizes after revocation and a late resource at the same access level', async () => {
  const pending = Promise.withResolvers<Loaded>();
  const cleanupSource = vi.fn();
  const load = vi
    .fn<() => Promise<Loaded>>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ userAccessLevel: 'view' });
  const container = mount(load);
  notifyAccess?.(null);
  pending.resolve({
    userAccessLevel: 'view',
    source: { cleanup: cleanupSource },
  });
  await pending.promise;
  await Promise.resolve();
  notifyAccess?.('view');
  await vi.waitFor(() =>
    expect(container.textContent).toContain('Document content: view')
  );
  expect(load).toHaveBeenCalledTimes(2);
  expect(cleanupSource).toHaveBeenCalledOnce();
});
