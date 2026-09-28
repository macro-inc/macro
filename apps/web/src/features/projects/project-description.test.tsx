import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
  create: vi.fn((_documentId: string) => ({
    connectionError: () => 'offline',
    dispose: () => {},
  })),
}));
vi.mock('./queries/production-project-description', () => ({
  createProductionProjectDescriptionSession: sessions.create,
}));
vi.mock('@core/collab-surface/CollabMarkdownEditor', () => ({
  CollabMarkdownEditor: () => null,
}));
vi.mock('@ui', () => ({
  Button: (props: ParentProps<{ onClick(): void }>) => (
    <button type="button" onClick={() => props.onClick()}>
      {props.children}
    </button>
  ),
}));

import { ProjectDescription } from './project-description';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens one session per document and retry, not per project refresh', () => {
  const [project, setProject] = createSignal({ descriptionDocumentId: 'a' });
  const view = render(() => (
    <ProjectDescription
      documentId={project().descriptionDocumentId}
      canEdit={true}
    />
  ));
  setProject({ descriptionDocumentId: 'a' });
  expect(sessions.create.mock.calls).toEqual([['a']]);
  setProject({ descriptionDocumentId: 'b' });
  expect(sessions.create.mock.calls).toEqual([['a'], ['b']]);
  fireEvent.click(view.getByText('Retry description'));
  expect(sessions.create.mock.calls).toEqual([['a'], ['b'], ['b']]);
});
