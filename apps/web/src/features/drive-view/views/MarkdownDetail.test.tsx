import { Telemetry } from '@macro-inc/observability';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { DetailErrorBoundary, MarkdownDetailBodyState } from './MarkdownDetail';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('shows a plain message for an error, never the error itself', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <MarkdownDetailBodyState
        entityLabel="task"
        error={new TypeError('Failed to fetch dynamically imported module')}
      />
    ),
    container
  );

  expect(container.textContent).toContain('This task couldn’t be displayed.');
  expect(container.textContent).not.toContain('TypeError');
  expect(container.textContent).not.toContain('dynamically imported module');
});

it('records a render error on telemetry and tries again', async () => {
  const recordError = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const error = new TypeError('Failed to fetch dynamically imported module');
  let fail = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  dispose = render(
    () => (
      <DetailErrorBoundary entityType="document" entityId="pdf-document">
        {(() => {
          const Detail = () => {
            if (fail) throw error;
            return <div>Document content</div>;
          };
          return <Detail />;
        })()}
      </DetailErrorBoundary>
    ),
    container
  );

  expect(container.textContent).toContain(
    'This document couldn’t be displayed.'
  );
  expect(container.textContent).not.toContain('dynamically imported module');
  expect(recordError).toHaveBeenCalledWith(error, {
    surface: 'drive-detail',
    'entity.type': 'document',
    'entity.id': 'pdf-document',
  });

  fail = false;
  [...container.querySelectorAll('button')]
    .find((button) => button.textContent === 'Try again')!
    .click();
  await vi.waitFor(() =>
    expect(container.textContent).toContain('Document content')
  );
  expect(recordError).toHaveBeenCalledOnce();
});
