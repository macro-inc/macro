import { ThrownResultError } from '@core/util/result';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

type Loaded = { userAccessLevel: AccessLevel };
function mount(load: () => Promise<Loaded>, cleanupEditor?: () => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <FileDetailLoadGate
        documentId="private-document"
        label="document"
        load={load}
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
