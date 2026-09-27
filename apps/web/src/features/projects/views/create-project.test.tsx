import { Dialog } from '@app/components/ui/components/Dialog';
import { focusPopoverInput } from '@components/app/split-layout/utils/focusPopoverInput';
import type { Property } from '@property/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type ComponentProps, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import type { ProjectComposerDraft } from '../primitives/create-project';
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
  descriptionDocumentId: 'description',
  ownerId: 'owner',
  memberIds: [],
  taskIds: [],
  access: 'owner',
  sharing: {},
  createdAt: '',
  updatedAt: '',
};
function commands() {
  return {
    pending: () => false,
    create: vi.fn(async () => project),
    saveProperty: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    share: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
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
    createChannelNamesSource: unused,
    createTasksSource: unused,
    createReferencesSource: unused,
    createPropertyDefinitionsSource: () => ({
      properties: () => [dueDate],
      loading: () => false,
      error: () => undefined,
    }),
    createCommands: () => service,
  };
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const onContinueInSplit = vi.fn();
  const onFailure = vi.fn();
  const content = () => (
    <ProjectsProvider context={context}>
      <CreateProject
        initialDraft={initialDraft}
        onCreated={onCreated}
        onClose={onClose}
        onContinueInSplit={onContinueInSplit}
        onFailure={onFailure}
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
  return { ...view, service, onCreated, onClose, onContinueInSplit, onFailure };
}

it('uses the native composer and submits edited property values and team-sharing choice', async () => {
  const { service, onCreated } = setup();
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
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('project'));
  expect(service.create).toHaveBeenCalledWith({
    name: 'Launch',
    shareWithTeam: false,
  });
  expect(service.saveProperty).toHaveBeenCalledWith('project', dueDate, {
    valueType: 'DATE',
    value: new Date('2026-10-01T00:00:00Z'),
  });
});

it('continues a failed property save in a split without losing the draft or creating a duplicate', async () => {
  const service = commands();
  service.saveProperty.mockRejectedValueOnce(new Error('offline'));
  const view = setup(service);
  fireEvent.input(screen.getByRole('textbox', { name: 'Project name' }), {
    target: { value: 'Launch' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Set due date' }));
  fireEvent.click(screen.getByRole('button', { name: /Create Project/ }));
  expect(await screen.findByRole('alert')).toHaveProperty(
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
  expect(view.onCreated).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue editing in split' })
  );
  const draft = view.onContinueInSplit.mock.calls[0][0] as ProjectComposerDraft;
  expect(draft.properties[0].value).toEqual({
    valueType: 'DATE',
    value: new Date('2026-10-01T00:00:00Z'),
  });
  cleanup();
  const continued = setup(service, draft);
  expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveProperty(
    'value',
    'Launch'
  );
  expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveProperty(
    'disabled',
    true
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Retry saving properties/ })
  );
  await waitFor(() =>
    expect(continued.onCreated).toHaveBeenCalledWith('project')
  );
  expect(service.create).toHaveBeenCalledTimes(1);
  expect(service.saveProperty).toHaveBeenCalledTimes(2);
});

it('retains the draft after creation fails, blocks duplicate keyboard submits, and clears intentionally', async () => {
  const service = commands();
  let rejectCreation!: (error: Error) => void;
  service.create.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectCreation = reject;
      })
  );
  const { onCreated } = setup(service);
  const title = screen.getByRole('textbox', { name: 'Project name' });
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  expect(service.create).not.toHaveBeenCalled();
  fireEvent.input(title, { target: { value: 'Launch' } });
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  expect(service.create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty(
    'disabled',
    true
  );
  rejectCreation(new Error('offline'));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'offline'
  );
  expect(title).toHaveProperty('value', 'Launch');
  fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('project'));
  expect(service.create).toHaveBeenCalledTimes(2);
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

it('returns the created identity and property draft for recovery if the composer closes during a failed save', async () => {
  const service = commands();
  let rejectSave!: (error: Error) => void;
  service.saveProperty.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      })
  );
  const view = setup(service);
  fireEvent.input(screen.getByRole('textbox', { name: 'Project name' }), {
    target: { value: 'Launch' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Set due date' }));
  fireEvent.click(screen.getByRole('button', { name: /Create Project/ }));
  await waitFor(() => expect(service.saveProperty).toHaveBeenCalledOnce());
  cleanup();
  rejectSave(new Error('offline'));
  await waitFor(() => expect(view.onFailure).toHaveBeenCalledOnce());
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(view.onFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Launch',
      createdId: 'project',
      shareWithTeam: true,
      properties: [
        {
          property: dueDate,
          value: { valueType: 'DATE', value: new Date('2026-10-01T00:00:00Z') },
        },
      ],
    })
  );
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
