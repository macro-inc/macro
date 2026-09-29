import { Dialog } from '@app/components/ui/components/Dialog';
import { focusPopoverInput } from '@components/app/split-layout/utils/focusPopoverInput';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ComponentProps, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type ProjectCreationResult,
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type {
  ProjectComposerDraft,
  ProjectComposerSubmission,
} from '../primitives/create-project';
import { dueDate, dueValue, fakeCommands } from '../tests/fixtures';
import { CreateProject } from './create-project';

vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Checkbox')),
  ...(await import('@app/components/ui/components/EntityComposer')),
  ...(await import('@app/components/ui/utils/classname')),
}));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
// The date picker is covered separately; exercise its real save contract here.
vi.mock('@property/component/PropertyValuePill', () => ({
  PropertyValuePill: (
    props: ComponentProps<
      typeof import('@property/component/PropertyValuePill').PropertyValuePill
    >
  ) => (
    <button
      type="button"
      disabled={!props.canEdit}
      onClick={() =>
        props.onSave?.(props.property, {
          valueType: 'DATE',
          value: new Date('2026-10-01T00:00:00Z'),
        })
      }
    >
      Set due date
    </button>
  ),
}));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(
  service = fakeCommands(),
  initialDraft?: ProjectComposerDraft,
  popover = false
) {
  const unused = (): never => {
    throw new Error('Unused capability');
  };
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unused,
    createPendingProjectsSource: unused,
    createProjectSource: unused,
    createReferencesSource: unused,
    createPropertyDefinitionsSource: () => ({
      properties: () => [dueDate],
      loading: () => false,
      error: () => undefined,
    }),
    createCommands: () => service,
  };
  const onSubmit = vi.fn((_submission: ProjectComposerSubmission) => {});
  const onClose = vi.fn();
  const onContinueInSplit = vi.fn();
  const content = () => (
    <ProjectsProvider context={context}>
      <CreateProject
        initialDraft={initialDraft}
        onSubmit={onSubmit}
        onClose={onClose}
        onContinueInSplit={onContinueInSplit}
      />
    </ProjectsProvider>
  );
  let panel: HTMLDivElement | undefined;
  const view = render(() => (
    <Show when={popover} fallback={content()}>
      <Dialog
        open
        contentRef={(element) => {
          panel = element;
        }}
        onOpenAutoFocus={(event) => focusPopoverInput(event, panel ?? null)}
      >
        <Dialog.Title>New project</Dialog.Title>
        {content()}
      </Dialog>
    </Show>
  ));
  return { ...view, service, onSubmit, onClose, onContinueInSplit };
}
it('hands its draft and creation to the host the moment it submits', async () => {
  const service = fakeCommands();
  const creation = Promise.withResolvers<ProjectCreationResult>();
  service.create.mockReturnValueOnce(creation.promise);
  const { onSubmit, onClose } = setup(service);
  expect(screen.queryByRole('dialog')).toBeNull();
  const title = screen.getByRole('textbox', { name: 'Project name' });
  expect(document.activeElement).toBe(title);
  expect(
    screen.getByRole('checkbox', { name: 'Share with my team' })
  ).toHaveProperty('checked', true);
  expect(screen.getByRole('button', { name: /Create Project/ })).toHaveProperty(
    'disabled',
    true
  );
  fireEvent.input(title, { target: { value: '  Launch  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set due date' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Share with my team' }));
  fireEvent.click(screen.getByRole('button', { name: /Create Project/ }));
  // Nothing is awaited: the list shows the project pending while the host closes.
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: false,
    properties: [{ property: dueDate, value: dueValue }],
    createdId: undefined,
  });
  expect(onSubmit).toHaveBeenCalledOnce();
  const [submission] = onSubmit.mock.calls[0];
  expect(submission.draft).toEqual({
    name: '  Launch  ',
    shareWithTeam: false,
    properties: [{ property: dueDate, value: dueValue }],
    createdId: undefined,
    error: undefined,
  });
  expect(onClose).not.toHaveBeenCalled();
  creation.resolve({ status: 'created', id: 'project' });
  expect(await submission.result).toEqual({ status: 'created', id: 'project' });
});

it('continues a reopened property failure in a split without losing the draft or creating a duplicate', () => {
  const service = fakeCommands();
  const view = setup(service, {
    name: 'Launch',
    shareWithTeam: true,
    properties: [{ property: dueDate, value: dueValue }],
    createdId: 'project',
    error:
      'Your project was created, but some properties could not be saved. Retry to finish saving it.',
  });
  expect(screen.getByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Retry')
  );
  expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveProperty(
    'disabled',
    true
  );
  expect(
    screen.getByRole('checkbox', { name: 'Share with my team' })
  ).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: 'Clear Draft' })).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue editing in split' })
  );
  const draft = view.onContinueInSplit.mock.calls[0][0] as ProjectComposerDraft;
  expect(draft).toMatchObject({ createdId: 'project' });
  expect(draft.properties[0].value).toEqual(dueValue);
  cleanup();
  const continued = setup(service, draft);
  expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveProperty(
    'value',
    'Launch'
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Retry saving properties/ })
  );
  expect(continued.onSubmit).toHaveBeenCalledOnce();
  // The retry names the existing project, so only its properties are saved.
  expect(service.create).toHaveBeenCalledOnce();
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: true,
    properties: [{ property: dueDate, value: dueValue }],
    createdId: 'project',
  });
});

it('shows a reopened creation failure and resubmits the same draft', () => {
  const service = fakeCommands();
  const { onSubmit } = setup(service, {
    name: 'Launch',
    shareWithTeam: true,
    properties: [],
    error: 'offline',
  });
  expect(screen.getByRole('alert')).toHaveProperty('textContent', 'offline');
  const title = screen.getByRole('textbox', { name: 'Project name' });
  expect(title).toHaveProperty('value', 'Launch');
  expect(title).toHaveProperty('disabled', false);
  fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true });
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: true,
    properties: [],
    createdId: undefined,
  });
  expect(onSubmit.mock.calls[0][0].draft.error).toBeUndefined();
});

it('blocks empty and duplicate keyboard submits, and clears intentionally', () => {
  const service = fakeCommands();
  const { onSubmit } = setup(service);
  const title = screen.getByRole('textbox', { name: 'Project name' });
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  expect(service.create).not.toHaveBeenCalled();
  fireEvent.input(title, { target: { value: 'Launch' } });
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  expect(service.create).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty(
    'disabled',
    true
  );
  cleanup();
  const fresh = setup();
  fireEvent.input(screen.getByRole('textbox', { name: 'Project name' }), {
    target: { value: 'Discard' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Set due date' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear Draft' }));
  expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveProperty(
    'value',
    ''
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue editing in split' })
  );
  expect(fresh.onContinueInSplit).toHaveBeenCalledWith({
    name: '',
    shareWithTeam: true,
    properties: [],
    createdId: undefined,
    error: undefined,
  });
});

it('keeps the project name focused after the popover applies initial focus', async () => {
  setup(fakeCommands(), undefined, true);
  await screen.findByRole('dialog');
  // Kobalte applies its default initial focus on the next timer, after child onMount.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.activeElement).toBe(
    screen.getByRole('textbox', { name: 'Project name' })
  );
});
