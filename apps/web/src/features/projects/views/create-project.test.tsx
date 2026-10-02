import { Dialog } from '@app/components/ui/components/Dialog';
import { focusPopoverInput } from '@components/app/split-layout/utils/focusPopoverInput';
import type { Property } from '@property/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ComponentProps, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import type {
  ProjectComposerDraft,
  ProjectComposerSubmission,
} from '../primitives/create-project';
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

const dueDate: Property = {
  propertyId: 'due',
  propertyDefinitionId: 'due',
  displayName: 'Due date',
  valueType: 'DATE',
  value: null,
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
};
const project: ProjectDetail = {
  id: 'project',
  name: 'Launch',
  descriptionSurfaceId: 'description',
  ownerId: 'owner',
  memberIds: [],
  taskIds: [],
  access: 'owner',
  createdAt: '',
  updatedAt: '',
};
function commands() {
  return {
    createTask: vi.fn(async () => null),
    pending: () => false,
    create: vi.fn(async () => project),
    saveProperty: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    deleteMany: vi.fn(async (): Promise<string[]> => []),
    saveProperties: vi.fn(async () => {}),
  } satisfies ReturnType<ProjectsContext['createCommands']>;
}
function setup(
  service = commands(),
  initialDraft?: ProjectComposerDraft,
  popover = false
) {
  const unused = (): never => {
    throw new Error('Unused capability');
  };
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unused,
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

const dueValue = {
  valueType: 'DATE' as const,
  value: new Date('2026-10-01T00:00:00Z'),
};

it('hands its draft and one create with the drafted values to the host the moment it submits', async () => {
  const { service, onSubmit, onClose } = setup();
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
  expect(service.create).toHaveBeenCalledOnce();
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: false,
    properties: [{ property: dueDate, value: dueValue }],
  });
  expect(service.saveProperty).not.toHaveBeenCalled();
  expect(onSubmit).toHaveBeenCalledOnce();
  const [submission] = onSubmit.mock.calls[0];
  expect(submission.draft).toEqual({
    name: '  Launch  ',
    shareWithTeam: false,
    properties: [{ property: dueDate, value: dueValue }],
  });
  // The host closes the composer; the view never waits for the server.
  expect(onClose).not.toHaveBeenCalled();
  expect(await submission.result).toBe(project);
});

it('shows a reopened creation failure and resubmits the same draft', () => {
  const service = commands();
  const { onSubmit } = setup(service, {
    name: 'Launch',
    shareWithTeam: true,
    properties: [{ property: dueDate, value: dueValue }],
    error: 'offline',
  });
  expect(screen.getByRole('alert')).toHaveProperty('textContent', 'offline');
  const title = screen.getByRole('textbox', { name: 'Project name' });
  expect(title).toHaveProperty('value', 'Launch');
  fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true });
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: true,
    properties: [{ property: dueDate, value: dueValue }],
  });
  expect(onSubmit.mock.calls[0][0].draft).not.toHaveProperty('error');
});

it('blocks empty and duplicate keyboard submits, and clears intentionally', () => {
  const service = commands();
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
    error: undefined,
  });
});

it('keeps the project name focused after the popover applies initial focus', async () => {
  setup(commands(), undefined, true);
  await screen.findByRole('dialog');
  // Kobalte applies its default initial focus on the next timer, after child onMount.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.activeElement).toBe(
    screen.getByRole('textbox', { name: 'Project name' })
  );
});
