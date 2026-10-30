import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProperty } from '../core/context';
import { Root } from '../core/Root';
import type { EntityProperty } from '../types';
import { ProjectLinkPill } from './ProjectLinkPill';

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  nativeProjectId: (): string | undefined => undefined,
  isLoading: (): boolean => false,
}));

vi.mock('@app/features/projects/open-project', () => ({
  openProject: mocks.openProject,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => 'layout',
}));
vi.mock('../hooks', () => ({
  usePropertyEntityDisplay: () => ({
    name: () => 'Launch',
    nativeProjectId: () => mocks.nativeProjectId(),
    isLoading: () => mocks.isLoading(),
  }),
}));

const project: EntityProperty = {
  propertyId: 'assignment',
  propertyDefinitionId: 'project',
  displayName: 'Project',
  valueType: 'ENTITY',
  specificEntityType: 'INITIATIVE',
  isMultiSelect: false,
  value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
  owner: { scope: 'system' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function EditorState() {
  const ctx = useProperty();
  return <output>{ctx.editorOpen() ? 'Editing' : 'Not editing'}</output>;
}

function renderPill(options: { canEdit?: boolean; property?: EntityProperty }) {
  const property = options.property ?? project;
  render(() => (
    <Root property={property} canEdit={options.canEdit ?? true}>
      <ProjectLinkPill property={property} fallback={<span>Plain pill</span>} />
      <EditorState />
    </Root>
  ));
}

beforeEach(() => {
  mocks.openProject.mockClear();
  mocks.nativeProjectId = () => 'launch';
  mocks.isLoading = () => false;
});
afterEach(cleanup);

it('opens the project from its name, in a new split on shift', () => {
  renderPill({});
  const name = screen.getByRole('button', { name: 'Open project Launch' });

  fireEvent.click(name);
  expect(mocks.openProject).toHaveBeenLastCalledWith('layout', 'launch', {
    newSplit: false,
  });

  fireEvent.click(name, { shiftKey: true });
  expect(mocks.openProject).toHaveBeenLastCalledWith('layout', 'launch', {
    newSplit: true,
  });
  expect(screen.getByText('Not editing')).toBeTruthy();
});

it('changes the project from the caret without opening it', () => {
  renderPill({});
  const caret = screen.getByRole('button', { name: 'Change project' });
  expect(caret.getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(caret);

  expect(screen.getByText('Editing')).toBeTruthy();
  expect(caret.getAttribute('aria-expanded')).toBe('true');
  expect(mocks.openProject).not.toHaveBeenCalled();
});

it('still opens the project for someone who cannot change it', () => {
  renderPill({ canEdit: false });

  expect(screen.queryByRole('button', { name: 'Change project' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open project Launch' }));
  expect(mocks.openProject).toHaveBeenCalledOnce();
});

it('stays a plain pill when there is no project to open', () => {
  mocks.nativeProjectId = () => undefined;
  renderPill({ property: { ...project, value: [] } });
  expect(screen.getByText('Plain pill')).toBeTruthy();
  cleanup();

  renderPill({});
  expect(screen.getByText('Plain pill')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

it('returns focus to the caret when the first project replaces the pill', async () => {
  const [property, setProperty] = createSignal<EntityProperty>({
    ...project,
    value: [],
  });
  const EmptyPill = () => {
    const ctx = useProperty();
    return (
      <button
        type="button"
        onClick={(event) => ctx.openEditor(event.currentTarget)}
      >
        Set project
      </button>
    );
  };
  const ClosePicker = () => {
    const ctx = useProperty();
    return (
      <button type="button" onClick={() => ctx.closeEditor()}>
        Close picker
      </button>
    );
  };
  render(() => (
    <Root property={property()} canEdit>
      <ProjectLinkPill property={property()} fallback={<EmptyPill />} />
      <ClosePicker />
    </Root>
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Set project' }));
  setProperty(project);
  fireEvent.click(screen.getByText('Close picker'));

  await waitFor(() =>
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Change project'
    )
  );
});

it('keeps the caret mounted while a picked project loads', () => {
  const [loading, setLoading] = createSignal(true);
  mocks.isLoading = loading;
  mocks.nativeProjectId = () => (loading() ? undefined : 'launch');
  renderPill({});
  const caret = screen.getByRole('button', { name: 'Change project' });

  fireEvent.click(screen.getByRole('button', { name: 'Open project Launch' }));
  expect(mocks.openProject).not.toHaveBeenCalled();

  setLoading(false);
  expect(screen.getByRole('button', { name: 'Change project' })).toBe(caret);
  fireEvent.click(screen.getByRole('button', { name: 'Open project Launch' }));
  expect(mocks.openProject).toHaveBeenCalledOnce();
});
