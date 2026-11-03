import type { ProjectPreviewData } from '@service-storage/generated/schemas';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createComponent, Suspense } from 'solid-js';
import { insert } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectBreadCrumb } from './ProjectBreadCrumb';

const request = vi.hoisted(() => vi.fn<() => Promise<ProjectPreviewData>>());

vi.mock('@queries/storage/project-preview', () => ({
  useProjectPreviewQuery: (projectId: Accessor<string>) =>
    useQuery(() => ({
      queryKey: ['project-preview', projectId()],
      queryFn: request,
      retry: false,
    })),
}));

afterEach(() => {
  cleanup();
  request.mockReset();
});

it('keeps the list mounted and scrolled while a folder preview resolves', async () => {
  const response = Promise.withResolvers<ProjectPreviewData>();
  request.mockReturnValue(response.promise);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClick = vi.fn();
  const listItem = document.createElement('div');
  listItem.textContent = 'Existing list row';
  const fallback = document.createElement('div');
  fallback.textContent = 'Parent fallback';

  const view = render(() =>
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(Suspense, {
          fallback,
          get children() {
            const viewport = document.createElement('div');
            viewport.append(listItem);
            insert(
              viewport,
              createComponent(ProjectBreadCrumb, {
                entity: {
                  type: 'project',
                  id: 'row',
                  name: 'Row',
                  ownerId: 'owner',
                  projectId: 'folder',
                },
                onClick,
              })
            );
            return viewport;
          },
        });
      },
    })
  );

  const viewport = listItem.parentElement!;
  viewport.scrollTop = 128;
  expect(view.container.contains(listItem)).toBe(true);
  expect(view.container.contains(fallback)).toBe(false);
  expect(viewport.querySelector('.skeleton-shimmer')).not.toBeNull();
  expect(viewport.scrollTop).toBe(128);
  expect(request).toHaveBeenCalledOnce();

  response.resolve({
    id: 'folder',
    name: 'Folder',
    owner: 'owner',
    path: ['Parent', 'Folder'],
  });
  await waitFor(() =>
    expect(viewport.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Parent/Folder'
    )
  );
  expect(view.container.contains(fallback)).toBe(false);
  expect(listItem.parentElement).toBe(viewport);
  expect(viewport.scrollTop).toBe(128);
  view.getByRole('button', { name: 'Parent/Folder' }).click();
  expect(onClick).toHaveBeenCalledWith(
    {
      type: 'project',
      id: 'folder',
      name: 'Folder',
      ownerId: 'owner',
      updatedAt: undefined,
    },
    expect.any(MouseEvent)
  );
  client.clear();
});

it('keeps a failed preview non-interactive without suspending the list', async () => {
  const response = Promise.withResolvers<ProjectPreviewData>();
  request.mockReturnValue(response.promise);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClick = vi.fn();
  const fallback = document.createElement('div');
  fallback.textContent = 'Parent fallback';

  const view = render(() =>
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(Suspense, {
          fallback,
          get children() {
            return createComponent(ProjectBreadCrumb, {
              entity: {
                type: 'project',
                id: 'row',
                name: 'Row',
                ownerId: 'owner',
                projectId: 'folder',
              },
              onClick,
            });
          },
        });
      },
    })
  );

  expect(request).toHaveBeenCalledOnce();
  response.reject(new Error('Preview unavailable'));
  await waitFor(() =>
    expect(
      view.container.querySelector('button')?.getAttribute('aria-disabled')
    ).toBe('true')
  );
  await waitFor(() =>
    expect(view.container.querySelector('.skeleton-shimmer')).toBeNull()
  );
  expect(view.container.contains(fallback)).toBe(false);
  view.getByRole('button').click();
  expect(onClick).not.toHaveBeenCalled();
  client.clear();
});
