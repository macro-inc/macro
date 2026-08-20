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

import { EntityLoadGate, type EntityLoadResult } from './EntityLoadGate';

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
});

describe('EntityLoadGate', () => {
  it('renders its child after data loads', () => {
    const container = renderGate({
      data: () => 'channel data',
      error: () => null,
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
            error: () => null,
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
      error: () => null,
      isPending: () => true,
    });

    expect(container.textContent).toBe('Loading');
  });

  it.each([
    ['UNAUTHORIZED', 'Unauthorized'],
    ['FORBIDDEN', 'Unauthorized'],
    ['NOT_FOUND', 'Not found'],
    ['GONE', 'Gone'],
  ])('renders the gated view for %s', (code, expected) => {
    const container = renderGate({
      data: () => undefined,
      error: () =>
        new ThrownResultError([{ code, message: 'entity load failed' }]),
      isPending: () => false,
    });

    expect(container.textContent).toBe(expected);
  });

  it('renders an unexpected-error fallback for other failures', () => {
    const container = renderGate({
      data: () => undefined,
      error: () => new Error('network unavailable'),
      isPending: () => false,
    });

    expect(container.textContent).toContain(
      'Sorry, an unexpected error has occurred.'
    );
  });
});
