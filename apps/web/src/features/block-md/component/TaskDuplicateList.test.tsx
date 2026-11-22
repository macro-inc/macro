import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SimilarTasksSection, taskDuplicatesArgs } from './TaskDuplicateList';

type Entity = { id: string; name: string };
const mocks = vi.hoisted(() => ({
  similarity: undefined as unknown as () => { data?: { taskId: string }[] },
  soup: undefined as unknown as () => {
    data?: { entities: Entity[] };
    isPlaceholderData: boolean;
  },
}));

vi.mock('@app/features/next-soup/soup-view/views/tasks/TaskListEntity', () => ({
  TaskListEntity: (props: { entity: Entity }) => (
    <div data-testid="task">{props.entity.name}</div>
  ),
}));
vi.mock('@entity', () => ({
  ListLayoutProvider: (props: ParentProps) => props.children,
}));
vi.mock('@property/tags/tag-sets-context', () => ({
  TagSetsQueryProvider: (props: ParentProps) => props.children,
}));
vi.mock('@solid-primitives/scheduled', () => ({
  debounce: (fn: (value: unknown) => void) => fn,
}));
vi.mock('@queries/storage/task-duplicates', () => ({
  useTaskSimilaritySearchQuery: () => ({
    get data() {
      return mocks.similarity().data;
    },
  }),
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => ({
    get data() {
      return mocks.soup().data;
    },
    get isPlaceholderData() {
      return mocks.soup().isPlaceholderData;
    },
  }),
}));

afterEach(cleanup);

it('reads the matched tasks over GraphQL, not the REST soup list', () => {
  expect(soupRestFallback(taskDuplicatesArgs(['task-1']))).toBeUndefined();
});

it('keeps the shown matches until the next matches arrive', () => {
  const [title, setTitle] = createSignal('first draft');
  const [matches, setMatches] = createSignal(['a1', 'a2']);
  const [soup, setSoup] = createSignal<{
    data?: { entities: Entity[] };
    isPlaceholderData: boolean;
  }>({
    data: {
      entities: [
        { id: 'a2', name: 'Second A' },
        { id: 'a1', name: 'First A' },
      ],
    },
    isPlaceholderData: false,
  });
  mocks.similarity = () => ({
    data: matches().map((taskId) => ({ taskId })),
  });
  mocks.soup = soup;
  const { container } = render(() => (
    <SimilarTasksSection
      title={title}
      content={() => ''}
      onOpenTask={() => undefined}
    />
  ));
  const shown = () =>
    [...container.querySelectorAll('[data-testid="task"]')].map(
      (node) => node.textContent
    );
  // In ranking order, not page order.
  expect(shown()).toEqual(['First A', 'Second A']);

  // New matches: their page is loading, the previous page stands in.
  setTitle('second draft');
  setMatches(['b1']);
  setSoup((current) => ({ ...current, isPlaceholderData: true }));
  expect(shown()).toEqual(['First A', 'Second A']);

  setSoup({
    data: { entities: [{ id: 'b1', name: 'Only B' }] },
    isPlaceholderData: false,
  });
  expect(shown()).toEqual(['Only B']);

  // No input: nothing to show, even though the query keeps its data.
  setTitle('');
  expect(shown()).toEqual([]);
});
