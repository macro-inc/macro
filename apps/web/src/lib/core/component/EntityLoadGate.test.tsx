/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AccessErrorViews/Gone', () => ({
  default: () => <div>Gone</div>,
}));
vi.mock('./AccessErrorViews/NotFound', () => ({
  default: () => <div>Not found</div>,
}));
vi.mock('./AccessErrorViews/Unauthorized', () => ({
  default: () => <div>Unauthorized</div>,
}));
vi.mock('./LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading</div>,
}));

let networkStatus: 'unknown' | 'online' | 'offline' = 'unknown';
vi.mock('@core/mobile/native-network-status', () => ({
  nativeNetworkStatus: () => networkStatus,
}));

import {
  type EntityLoadErrorCode,
  EntityLoadGate,
  type EntityLoadResult,
  toEntityLoadError,
} from './EntityLoadGate';

let dispose: (() => void) | undefined;

function renderGate<Data>(result: EntityLoadResult<Data>): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const disposeRender = render(
    () => (
      <EntityLoadGate result={result}>
        <div>Loaded</div>
      </EntityLoadGate>
    ),
    container
  );
  dispose = () => {
    disposeRender();
    container.remove();
  };
  return container;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  networkStatus = 'unknown';
});

describe('EntityLoadGate', () => {
  it('renders its child after data loads', () => {
    const container = renderGate({
      data: () => 'channel data',
      error: () => undefined,
      isPending: () => false,
    });

    expect(container.textContent).toBe('Loaded');
  });

  it.each([
    { label: 'zero', data: 0 },
    { label: 'false', data: false },
    { label: 'an empty string', data: '' },
  ])('renders its child when data is $label', ({ data }) => {
    const container = renderGate({
      data: () => data,
      error: () => undefined,
      isPending: () => false,
    });

    expect(container.textContent).toBe('Loaded');
  });

  it('does not mount its child while data is pending', () => {
    let childMounted = false;
    const Child = () => {
      childMounted = true;
      return <div>Loaded</div>;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const disposeRender = render(
      () => (
        <EntityLoadGate
          result={{
            data: () => undefined,
            error: () => undefined,
            isPending: () => true,
          }}
        >
          <Child />
        </EntityLoadGate>
      ),
      container
    );
    dispose = () => {
      disposeRender();
      container.remove();
    };

    expect(childMounted).toBe(false);
    expect(container.textContent).toBe('Loading');
  });

  it('renders loading while data is pending', () => {
    const container = renderGate({
      data: () => undefined,
      error: () => undefined,
      isPending: () => true,
    });

    expect(container.textContent).toBe('Loading');
  });

  it.each<readonly [EntityLoadErrorCode, string]>([
    ['UNAUTHORIZED', 'Unauthorized'],
    ['FORBIDDEN', 'Unauthorized'],
    ['NOT_FOUND', 'Not found'],
    ['GONE', 'Gone'],
  ])('renders the gated view for %s', (code, expected) => {
    const container = renderGate({
      data: () => undefined,
      error: () => code,
      isPending: () => false,
    });

    expect(container.textContent).toBe(expected);
  });

  it('renders the retryable load-error state for other failures', () => {
    const container = renderGate({
      data: () => undefined,
      error: () => 'LOAD_FAILED',
      isPending: () => false,
    });

    expect(container.textContent).toContain('Unable to load this view');
    expect(container.textContent).toContain(
      'Check your internet connection and try again.'
    );
  });

  it('renders loaded content over a LOAD_FAILED error', () => {
    const container = renderGate({
      data: () => 'cached entity',
      error: () => 'LOAD_FAILED',
      isPending: () => false,
    });

    expect(container.textContent).toBe('Loaded');
  });

  it('renders the structural error view even over loaded content', () => {
    const container = renderGate({
      data: () => 'cached entity',
      error: () => 'UNAUTHORIZED',
      isPending: () => false,
    });

    expect(container.textContent).toBe('Unauthorized');
  });

  it('renders the retryable load-error state when offline with nothing to show', () => {
    networkStatus = 'offline';
    const container = renderGate({
      data: () => undefined,
      error: () => undefined,
      isPending: () => true,
    });

    expect(container.textContent).toContain('Unable to load this view');
  });

  it('renders loaded content while offline', () => {
    networkStatus = 'offline';
    const container = renderGate({
      data: () => 'cached entity',
      error: () => undefined,
      isPending: () => false,
    });

    expect(container.textContent).toBe('Loaded');
  });

  it('invokes onRetry from the load-error state', () => {
    const onRetry = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const disposeRender = render(
      () => (
        <EntityLoadGate
          result={{
            data: () => undefined,
            error: () => 'LOAD_FAILED',
            isPending: () => false,
          }}
          onRetry={onRetry}
        >
          <div>Loaded</div>
        </EntityLoadGate>
      ),
      container
    );
    dispose = () => {
      disposeRender();
      container.remove();
    };

    const retryButton = container.querySelector('button');
    expect(retryButton?.textContent).toContain('Retry');
    retryButton?.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('normalizes query errors into gate errors', () => {
    expect(
      toEntityLoadError(
        new ThrownResultError([
          { code: 'NOT_FOUND', message: 'entity load failed' },
        ])
      )
    ).toBe('NOT_FOUND');
    expect(toEntityLoadError(new Error('network unavailable'))).toBe(
      'LOAD_FAILED'
    );
  });
});
