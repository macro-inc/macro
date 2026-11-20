import { TraceFlow, useFlow } from '@app/observability/flow';
import { initializeUiOperationTelemetry } from '@app/observability/ui-operation';
import { guardResponseBody } from '@core/util/response-observers';
import { ThrownResultError } from '@core/util/result';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publicationBarrier = vi.hoisted(() => ({
  wait: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('solid-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('solid-js')>();
  return {
    ...actual,
    createResource: (...args: Parameters<typeof actual.createResource>) => {
      const [source, fetcher, options] = args;
      return actual.createResource(
        source,
        async (value, info) => {
          const result = await fetcher(value, info);
          await publicationBarrier.wait?.();
          return result;
        },
        options
      );
    },
  };
});

const analytics = vi.hoisted(() => ({ pageView: vi.fn(), track: vi.fn() }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => analytics,
}));
const trackOpen = vi.hoisted(() => vi.fn());
vi.mock('@core/internal/track-open', () => ({ trackOpen }));
vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@components/app/side-panel', () => ({}));
const invalidateBundle = vi.hoisted(() => vi.fn(async () => {}));
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
  publicationBarrier.wait = undefined;
  disposeTelemetry = initializeUiOperationTelemetry();
  invalidateBundle.mockClear();
});

it('does not hand a retired accepted result to its viewer after resource delivery', async () => {
  const accepted = Promise.withResolvers<void>();
  const deliver = Promise.withResolvers<void>();
  const published = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  const discard = vi.fn();
  publicationBarrier.wait = () => {
    accepted.resolve();
    return deliver.promise;
  };
  const load = vi
    .fn<() => Promise<Loaded>>()
    .mockResolvedValueOnce({
      userAccessLevel: 'owner',
      source: { cleanup: cleanupSource },
    })
    .mockResolvedValue({ userAccessLevel: 'view' });
  const container = mount(load, undefined, undefined, discard);
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const value = container.textContent ?? '';
    if (value.includes('Document content')) {
      seen.push(value);
      published.resolve();
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  try {
    await accepted.promise;
    await cacheSessionGeneration.transition(async () => {});
    publicationBarrier.wait = undefined;
    deliver.resolve();
    await published.promise;
    expect(seen.every((value) => !value.includes('owner'))).toBe(true);
    expect(container.textContent).toContain('Document content: view');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cleanupSource).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
  } finally {
    observer.disconnect();
    deliver.resolve();
  }
});

it('bounds recovery across two retired resource deliveries and discards both results', async () => {
  const accepted = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  const deliver = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  const failed = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  const discard = vi.fn();
  let delivery = 0;
  publicationBarrier.wait = () => {
    const index = delivery++;
    accepted[index]?.resolve();
    return deliver[index]?.promise ?? Promise.resolve();
  };
  const load = vi.fn(
    async (): Promise<Loaded> => ({
      userAccessLevel: 'view',
      source: { cleanup: cleanupSource },
    })
  );
  const container = mount(load, undefined, undefined, discard);
  const observer = new MutationObserver(() => {
    if (container.textContent?.includes('couldn’t be displayed'))
      failed.resolve();
  });
  observer.observe(container, { childList: true, subtree: true });
  try {
    for (let index = 0; index < 2; index++) {
      await accepted[index].promise;
      await cacheSessionGeneration.transition(async () => {});
      deliver[index].resolve();
    }
    await failed.promise;
    expect(load).toHaveBeenCalledTimes(2);
    expect(cleanupSource).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Document content');
  } finally {
    observer.disconnect();
    for (const waiting of deliver) waiting.resolve();
  }
});
afterEach(() => {
  analytics.track.mockClear();
  trackOpen.mockClear();
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
  cleanupEditor?: () => void,
  documentId: Accessor<string> = () => 'private-document',
  discard?: (data: Loaded) => void
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <FileDetailLoadGate
        documentId={documentId()}
        entityType="md"
        label="document"
        load={load}
        recover={invalidateBundle}
        dispose={(data) => data.source?.cleanup()}
        discard={discard}
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

it('restarts an interrupted file load instead of publishing its stale content', async () => {
  const pending = Promise.withResolvers<Loaded>();
  const published = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  const discard = vi.fn();
  const load = vi
    .fn<() => Promise<Loaded>>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ userAccessLevel: 'view' });
  const container = mount(load, undefined, undefined, discard);
  const observer = new MutationObserver(() => {
    if (container.textContent?.includes('Document content'))
      published.resolve();
  });
  observer.observe(container, { childList: true, subtree: true });
  try {
    await cacheSessionGeneration.transition(async () => {});
    pending.resolve({
      userAccessLevel: 'owner',
      source: { cleanup: cleanupSource },
    });
    await published.promise;
    expect(container.textContent).toContain('Document content: view');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cleanupSource).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledExactlyOnceWith({
      userAccessLevel: 'owner',
      source: { cleanup: cleanupSource },
    });
    expect(invalidateBundle).toHaveBeenCalledExactlyOnceWith(
      'private-document'
    );
  } finally {
    observer.disconnect();
  }
  dispose?.();
  dispose = undefined;
  // The rendered viewer owns its PDF proxy; only the discarded proxy uses this hook.
  expect(discard).toHaveBeenCalledOnce();
});

it('waits for local cleanup before retrying a stale body decode', async () => {
  const body = Promise.withResolvers<void>();
  const decoded = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const recovered = Promise.withResolvers<void>();
  const recovering = Promise.withResolvers<void>();
  const nextCleanup = Promise.withResolvers<void>();
  const nextCleanupStarted = Promise.withResolvers<void>();
  const adapterStarted = Promise.withResolvers<void>();
  const adapterReady = Promise.withResolvers<void>();
  invalidateBundle.mockImplementationOnce(async () => {
    adapterStarted.resolve();
    await adapterReady.promise;
  });
  const settled = cacheSessionGeneration.settled;
  vi.spyOn(cacheSessionGeneration, 'settled').mockImplementation(() => {
    recovering.resolve();
    return settled();
  });
  const load = vi.fn(async () => {
    const generation = cacheSessionGeneration.capture();
    if (load.mock.calls.length === 1) await body.promise;
    else recovered.resolve();
    const response = guardResponseBody(new Response('%PDF-1.7'), () => {
      if (!cacheSessionGeneration.isCurrent(generation))
        throw new StaleCacheAuthorityError();
    });
    try {
      await response.arrayBuffer();
      return { userAccessLevel: 'view' as const };
    } finally {
      decoded.resolve();
    }
  });
  mount(load);
  const retirement = cacheSessionGeneration.transition(() => cleanup.promise);
  body.resolve();
  await decoded.promise;
  await recovering.promise;
  const nextRetirement = cacheSessionGeneration.transition(() => {
    nextCleanupStarted.resolve();
    return nextCleanup.promise;
  });
  expect(load).toHaveBeenCalledOnce();
  cleanup.resolve();
  await nextCleanupStarted.promise;
  expect(invalidateBundle).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledOnce();
  nextCleanup.resolve();
  await retirement;
  await nextRetirement;
  await adapterStarted.promise;
  expect(load).toHaveBeenCalledOnce();
  adapterReady.resolve();
  await recovered.promise;
  expect(load).toHaveBeenCalledTimes(2);
});

it('honors a fresh denial after discarding an interrupted file load', async () => {
  const pending = Promise.withResolvers<Loaded>();
  const denied = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  const load = vi
    .fn<() => Promise<Loaded>>()
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValue(
      new ThrownResultError([{ code: 'FORBIDDEN', message: 'Access denied' }])
    );
  const container = mount(load);
  const observer = new MutationObserver(() => {
    if (container.textContent?.includes('Request access')) denied.resolve();
  });
  observer.observe(container, { childList: true, subtree: true });
  try {
    await cacheSessionGeneration.transition(async () => {});
    pending.resolve({
      userAccessLevel: 'owner',
      source: { cleanup: cleanupSource },
    });
    await denied.promise;
    expect(container.textContent).not.toContain('Document content');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cleanupSource).toHaveBeenCalledOnce();
  } finally {
    observer.disconnect();
  }
});

it('stops after a second interruption and releases both discarded resources', async () => {
  const first = Promise.withResolvers<Loaded>();
  const second = Promise.withResolvers<Loaded>();
  const started = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<void>();
  const cleanupFirst = vi.fn();
  const cleanupSecond = vi.fn();
  const load = vi
    .fn<() => Promise<Loaded>>()
    .mockReturnValueOnce(first.promise)
    .mockImplementationOnce(() => {
      started.resolve();
      return second.promise;
    });
  const container = mount(load);
  const observer = new MutationObserver(() => {
    if (container.textContent?.includes('couldn’t be displayed'))
      failed.resolve();
  });
  observer.observe(container, { childList: true, subtree: true });
  try {
    await cacheSessionGeneration.transition(async () => {});
    first.resolve({
      userAccessLevel: 'owner',
      source: { cleanup: cleanupFirst },
    });
    await started.promise;
    await cacheSessionGeneration.transition(async () => {});
    second.resolve({
      userAccessLevel: 'view',
      source: { cleanup: cleanupSecond },
    });
    await failed.promise;
    expect(container.textContent).not.toContain('Document content');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cleanupFirst).toHaveBeenCalledOnce();
    expect(cleanupSecond).toHaveBeenCalledOnce();
  } finally {
    observer.disconnect();
  }
});

it('does not recover an interrupted load after the view is disposed', async () => {
  const pending = Promise.withResolvers<Loaded>();
  const released = Promise.withResolvers<void>();
  const load = vi.fn(() => pending.promise);
  mount(load);
  await cacheSessionGeneration.transition(async () => {});
  dispose?.();
  dispose = undefined;
  pending.resolve({
    userAccessLevel: 'owner',
    source: { cleanup: () => released.resolve() },
  });
  await released.promise;
  expect(load).toHaveBeenCalledOnce();
  expect(invalidateBundle).not.toHaveBeenCalled();
});

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
    expect(trackOpen.mock.calls).toEqual([
      ['private-document', 'md', expect.any(Function)],
    ]);
  });

  it('records a second document opened in the same view', async () => {
    const [documentId, setDocumentId] = createSignal('private-document');
    const container = mount(
      async () => ({ userAccessLevel: 'view' }),
      undefined,
      documentId
    );
    await vi.waitFor(() => expect(trackOpen).toHaveBeenCalledTimes(1));
    setDocumentId('next-document');
    await vi.waitFor(() => expect(trackOpen).toHaveBeenCalledTimes(2));
    expect(container.textContent).toContain('Document content');

    expect(trackOpen.mock.calls.map(([id, block]) => [id, block])).toEqual([
      ['private-document', 'md'],
      ['next-document', 'md'],
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
    expect(trackOpen).not.toHaveBeenCalled();
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

it('shows a plain message for a failed load and retries it', async () => {
  const load = vi
    .fn<() => Promise<Loaded>>()
    .mockRejectedValueOnce(
      new ThrownResultError([
        { code: 'NETWORK_ERROR', message: 'Network error occurred' },
      ])
    )
    .mockResolvedValue({ userAccessLevel: 'view' });
  const container = mount(load);
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      'This document couldn’t be displayed.'
    )
  );
  expect(container.textContent).not.toContain('ThrownResultError');
  expect(container.textContent).not.toContain('Network error occurred');

  [...container.querySelectorAll('button')]
    .find((button) => button.textContent === 'Try again')!
    .click();
  await vi.waitFor(() =>
    expect(container.textContent).toContain('Document content: view')
  );
  expect(load).toHaveBeenCalledTimes(2);
});

it('records a render error on telemetry instead of showing it', async () => {
  const recordError = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  let fail = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <FileDetailLoadGate
        documentId="image-document"
        entityType="image"
        label="image"
        recover={invalidateBundle}
        load={async () => ({ userAccessLevel: 'view' })}
      >
        {() => {
          if (fail) throw new Error('Image decode failed');
          return <div>Image content</div>;
        }}
      </FileDetailLoadGate>
    ),
    container
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain('This image couldn’t be displayed.')
  );
  expect(container.textContent).not.toContain('Image decode failed');
  expect(recordError).toHaveBeenCalledWith(new Error('Image decode failed'), {
    surface: 'file-detail',
    'doc.type': 'image',
    'document.id': 'image-document',
  });

  fail = false;
  [...container.querySelectorAll('button')]
    .find((button) => button.textContent === 'Try again')!
    .click();
  await vi.waitFor(() =>
    expect(container.textContent).toContain('Image content')
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
          recover={invalidateBundle}
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
  expect(trackOpen).not.toHaveBeenCalled();
  notifyAccess?.('view');
  await vi.waitFor(() =>
    expect(container.textContent).toContain('Document content: view')
  );
  expect(load).toHaveBeenCalledTimes(2);
  expect(cleanupSource).toHaveBeenCalledOnce();
  expect(trackOpen).toHaveBeenCalledOnce();
});
