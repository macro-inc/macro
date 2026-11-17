import type { FolderPreview } from '@queries/storage/project-preview';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createComponent, Suspense } from 'solid-js';
import { insert } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { KnownFoldersProvider } from '../context/known-folders';
import type { KnownFolder } from '../utils/folder-path';
import { ProjectBreadCrumb } from './ProjectBreadCrumb';

const request = vi.hoisted(() => vi.fn<() => Promise<FolderPreview>>());

vi.mock('@queries/storage/project-preview', () => ({
  useProjectPreviewQuery: (
    projectId: Accessor<string>,
    enabled: Accessor<boolean> = () => true
  ) =>
    useQuery(() => ({
      queryKey: ['project-preview', projectId()],
      queryFn: request,
      retry: false,
      enabled: enabled(),
    })),
}));

afterEach(() => {
  cleanup();
  request.mockReset();
});

it('keeps the list mounted and scrolled while a folder preview resolves', async () => {
  const response = Promise.withResolvers<FolderPreview>();
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
  const response = Promise.withResolvers<FolderPreview>();
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

it('shows a page of nested folder rows from the known folders without a request per row', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const folders: KnownFolder[] = [
    { id: 'root', name: 'Clients', parentId: null, ownerId: 'owner' },
    { id: 'archive', name: 'Archive 01', parentId: 'root', ownerId: 'owner' },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `quarter-${index}`,
      name: `Q${index}`,
      parentId: 'archive',
      ownerId: 'owner',
    })),
  ];
  const known = new Map(folders.map((folder) => [folder.id, folder]));

  const view = render(() =>
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(KnownFoldersProvider, {
          value: () => known,
          get children() {
            return Array.from({ length: 20 }, (_, index) =>
              createComponent(ProjectBreadCrumb, {
                entity: {
                  type: 'project',
                  id: `row-${index}`,
                  name: `Row ${index}`,
                  ownerId: 'owner',
                  projectId: `quarter-${index}`,
                },
              })
            );
          },
        });
      },
    })
  );

  expect(request).not.toHaveBeenCalled();
  expect(
    view.getByRole('button', { name: 'Clients/Archive 01/Q7' })
  ).toBeTruthy();
  client.clear();
});
