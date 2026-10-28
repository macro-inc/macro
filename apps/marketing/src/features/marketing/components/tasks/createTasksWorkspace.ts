import { batch, createMemo, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { taskChannelHistory } from './taskChannelHistory';
import { type DemoProject, tasksWorkspaceData } from './tasksWorkspaceData';

export type TasksTab = 'mine' | 'all' | 'created' | 'projects';
export type GroupBy = 'None' | 'Status' | 'Priority' | 'Assignee' | 'Project';
export const taskStatuses = [
  'Not Started',
  'In Progress',
  'In Review',
  'Completed',
  'Canceled',
] as const;
export const priorities = ['Urgent', 'High', 'Medium', 'Low'] as const;
export const projectStatuses = [
  'Not Started',
  'In Progress',
  'Completed',
] as const;

/** Local commands replace the app's queries; navigation and project membership are real demo state. */
export function createTasksWorkspace(w: DummyWorkspace) {
  const seed = tasksWorkspaceData();
  w.setData('tasks', seed.tasks);
  w.setData(
    'channels',
    seed.projects.map((project) => ({
      id: project.id,
      messages: [
        ...seed.tasks
          .filter((task) => task.channel === project.id)
          .map((task) => ({
            id: `request-${task.id}`,
            person: task.creator,
            time: 'Yesterday',
            body: task.description,
            taskId: task.id,
          })),
        ...taskChannelHistory(project.id),
      ],
    }))
  );
  w.setChannel('sales');
  const [projects, setProjects] = createStore(seed.projects);
  const [metadata, setMetadata] = createStore(seed.metadata);
  seed.projects.forEach((project, index) =>
    setMetadata(project.id, {
      projectId: '',
      updated: 100 - index,
      created: index,
    })
  );
  const [tab, setTab] = createSignal<TasksTab>('all');
  const [projectId, setProjectId] = createSignal<string>();
  const [section, setSection] = createSignal<'overview' | 'tasks'>('overview');
  const [search, setSearch] = createSignal('');
  const [group, setGroup] = createSignal<GroupBy>('Priority');
  const [layout, setLayout] = createSignal<'List' | 'Board'>('List');
  const [sort, setSort] = createSignal<'Updated' | 'Created'>('Updated');
  const [filters, setFilters] = createStore({
    status: [] as string[],
    priority: [] as string[],
    owner: [] as string[],
    tag: '',
  });
  const [composer, setComposer] = createSignal<'task' | 'project'>();
  const [adding, setAdding] = createSignal(false);
  let revision = 101;
  const project = () => projects.find((item) => item.id === projectId());
  const task = () => w.data.tasks.find((item) => item.id === w.selected());
  const projectList = () => tab() === 'projects' && !projectId();
  const clear = () => {
    setSearch('');
    setFilters({ status: [], priority: [], owner: [], tag: '' });
  };
  const views = new Map<
    string,
    { layout: 'List' | 'Board'; group: GroupBy; sort: 'Updated' | 'Created' }
  >();
  const scope = () =>
    projectId() ? `project:${projectId()}` : `tasks:${tab()}`;
  const rememberView = () =>
    views.set(scope(), { layout: layout(), group: group(), sort: sort() });
  const restoreView = (defaultGroup: GroupBy) => {
    const saved = views.get(scope());
    setLayout(saved?.layout ?? 'List');
    setGroup(saved?.group ?? defaultGroup);
    setSort(saved?.sort ?? 'Updated');
  };
  const navigate = (next: TasksTab) =>
    batch(() => {
      rememberView();
      setTab(next);
      setProjectId(undefined);
      clear();
      restoreView(next === 'projects' ? 'Status' : 'Priority');
      w.open('tasks');
    });
  const openProject = (id: string, next: 'overview' | 'tasks' = 'overview') =>
    batch(() => {
      rememberView();
      setTab('projects');
      setProjectId(id);
      setSection(next);
      clear();
      restoreView('Status');
      w.open('tasks');
    });
  const openTask = (id: string) => w.open('tasks', id);
  const back = () => w.open('tasks');
  const saveTask = (id: string, patch: Partial<WorkspaceTask>) => {
    w.updateTask(id, patch);
    if (metadata[id]) setMetadata(id, 'updated', ++revision);
  };
  const saveProject = (id: string, patch: Partial<DemoProject>) => {
    setProjects((item) => item.id === id, patch);
    setMetadata(id, 'updated', ++revision);
  };
  const assignProject = (id: string, next: string) => {
    setMetadata(id, {
      projectId: next,
      updated: ++revision,
      created: metadata[id]?.created ?? revision,
      dueDate: metadata[id]?.dueDate,
    });
  };
  const projectName = (id: string) =>
    projects.find((item) => item.id === metadata[id]?.projectId)?.title ??
    'No project';
  const matches = (item: WorkspaceTask) =>
    `${item.title} ${item.description}`
      .toLowerCase()
      .includes(search().toLowerCase()) &&
    (!filters.status.length || filters.status.includes(item.status)) &&
    (!filters.priority.length || filters.priority.includes(item.priority)) &&
    (!filters.owner.length || filters.owner.includes(item.owner)) &&
    (!filters.tag || item.tags.includes(filters.tag));
  const tasks = createMemo(() =>
    w.data.tasks
      .filter(
        (item) =>
          matches(item) &&
          (!projectId() || metadata[item.id]?.projectId === projectId()) &&
          (tab() !== 'mine' || item.owner === 'jacob') &&
          (tab() !== 'created' || item.creator === 'jacob')
      )
      .slice()
      .sort(
        (a, b) =>
          (metadata[b.id]?.[sort() === 'Updated' ? 'updated' : 'created'] ??
            0) -
          (metadata[a.id]?.[sort() === 'Updated' ? 'updated' : 'created'] ?? 0)
      )
  );
  const visibleProjects = createMemo(() =>
    projects
      .filter(matches)
      .slice()
      .sort(
        (a, b) =>
          (metadata[b.id]?.[sort() === 'Updated' ? 'updated' : 'created'] ??
            0) -
          (metadata[a.id]?.[sort() === 'Updated' ? 'updated' : 'created'] ?? 0)
      )
  );
  const groupValue = (item: WorkspaceTask) =>
    group() === 'Status'
      ? item.status
      : group() === 'Priority'
        ? item.priority
        : group() === 'Assignee'
          ? item.owner
          : group() === 'Project'
            ? projectName(item.id)
            : 'All tasks';
  const groups = createMemo(() => {
    const rows: WorkspaceTask[] = projectList() ? visibleProjects() : tasks();
    const keys =
      group() === 'Status'
        ? [...(projectList() ? projectStatuses : taskStatuses)]
        : group() === 'Priority'
          ? [...priorities]
          : [...new Set(rows.map(groupValue))];
    return keys
      .map((key) => ({
        key,
        items: rows.filter((item) => groupValue(item) === key),
      }))
      .filter(
        (entry) =>
          entry.items.length || (layout() === 'Board' && group() === 'Status')
      );
  });
  const toggleFilter = (key: 'status' | 'priority' | 'owner', value: string) =>
    setFilters(key, (values) =>
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value]
    );
  const create = (draft: WorkspaceTask, dueDate?: string) =>
    batch(() => {
      if (composer() === 'project') {
        const id = crypto.randomUUID();
        setProjects((items) => [
          ...items,
          {
            ...draft,
            id,
            status:
              draft.status === 'Completed'
                ? 'Completed'
                : draft.status === 'In Progress'
                  ? 'In Progress'
                  : 'Not Started',
            dueDate: dueDate ?? '',
          },
        ]);
        setMetadata(id, {
          projectId: '',
          updated: ++revision,
          created: revision,
        });
        navigate('projects');
      } else {
        const id = w.createTask(
          draft.title,
          draft.description,
          projectId() ?? 'customers'
        );
        saveTask(id, { ...draft, id });
        setMetadata(id, {
          projectId: projectId() ?? '',
          updated: ++revision,
          created: revision,
          dueDate,
        });
        w.open('tasks');
      }
      setComposer(undefined);
    });
  const reset = () => {
    const next = tasksWorkspaceData();
    w.setData('tasks', next.tasks);
    w.setData(
      'channels',
      next.projects.map((project) => ({
        id: project.id,
        messages: [
          ...next.tasks
            .filter((task) => task.channel === project.id)
            .map((task) => ({
              id: `request-${task.id}`,
              person: task.creator,
              time: 'Yesterday',
              body: task.description,
              taskId: task.id,
            })),
          ...taskChannelHistory(project.id),
        ],
      }))
    );
    w.setChannel('sales');
    next.projects.forEach((project, index) => {
      next.metadata[project.id] = {
        projectId: '',
        updated: 100 - index,
        created: index,
      };
    });
    setProjects(reconcile(next.projects));
    setMetadata(reconcile(next.metadata));
    views.clear();
    setLayout('List');
    setGroup('Priority');
    setSort('Updated');
    setComposer(undefined);
    setAdding(false);
    navigate('all');
  };
  return {
    reset,
    w,
    projects,
    metadata,
    tab,
    projectId,
    project,
    task,
    projectList,
    section,
    setSection,
    search,
    setSearch,
    group,
    setGroup,
    layout,
    setLayout,
    sort,
    setSort,
    filters,
    setFilters,
    composer,
    setComposer,
    adding,
    setAdding,
    navigate,
    openProject,
    openTask,
    back,
    saveTask,
    saveProject,
    assignProject,
    projectName,
    tasks,
    visibleProjects,
    groups,
    toggleFilter,
    clear,
    create,
  };
}
export type TasksWorkspace = ReturnType<typeof createTasksWorkspace>;
