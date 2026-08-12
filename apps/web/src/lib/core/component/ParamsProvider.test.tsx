/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { type Accessor, createEffect, on } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParamsProvider, useUrlParams } from './ParamsProvider';

type MockSearchParams = Record<string, string | string[] | undefined>;

const mocks = vi.hoisted(() => ({
  registeredMethods: {} as Record<
    string,
    (params: Record<string, string>) => void
  >,
  searchParams: undefined as MockSearchParams | undefined,
  setSearchParams: undefined as SetStoreFunction<MockSearchParams> | undefined,
}));

vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('@core/orchestrator', () => ({
  createMethodRegistration: (
    _blockHandle: Accessor<unknown>,
    methods: Record<string, (params: Record<string, string>) => void>
  ) => {
    mocks.registeredMethods = methods;
  },
}));

vi.mock('@core/signal/load', () => ({
  blockHandleSignal: {
    get: () => ({}),
  },
}));

const URL_PARAMS = {
  nodeId: 'node_id',
  location: 'location',
  commentId: 'comment_id',
} as const;

type Counts = Record<keyof typeof URL_PARAMS, number>;
type Values = Record<keyof typeof URL_PARAMS, string | undefined>;

function createCounts(): Counts {
  return {
    nodeId: 0,
    location: 0,
    commentId: 0,
  };
}

function resetCounts(counts: Counts) {
  counts.nodeId = 0;
  counts.location = 0;
  counts.commentId = 0;
}

function Consumer(props: { counts: Counts; values: Values }) {
  const params = useUrlParams(URL_PARAMS);

  createEffect(
    on(params.nodeId, (value) => {
      props.counts.nodeId++;
      props.values.nodeId = value;
    })
  );
  createEffect(
    on(params.location, (value) => {
      props.counts.location++;
      props.values.location = value;
    })
  );
  createEffect(
    on(params.commentId, (value) => {
      props.counts.commentId++;
      props.values.commentId = value;
    })
  );

  return null;
}

async function settle() {
  await Promise.resolve();
}

function renderHarness(initialSearchParams: MockSearchParams = {}) {
  const counts = createCounts();
  const values: Values = {
    nodeId: undefined,
    location: undefined,
    commentId: undefined,
  };
  const [searchParams, setSearchParams] =
    createStore<MockSearchParams>(initialSearchParams);
  mocks.searchParams = searchParams;
  mocks.setSearchParams = setSearchParams;

  const rendered = render(() => (
    <ParamsProvider>
      <Consumer counts={counts} values={values} />
    </ParamsProvider>
  ));

  return {
    ...rendered,
    counts,
    values,
    setSearchParams,
  };
}

beforeEach(() => {
  mocks.registeredMethods = {};
  mocks.searchParams = undefined;
  mocks.setSearchParams = undefined;
});

describe('ParamsProvider', () => {
  it('does not notify consumers when unrelated URL params change', async () => {
    const { counts, values, setSearchParams } = renderHarness({
      node_id: 'node-1',
      location: 'loc-1',
      comment_id: 'comment-1',
    });
    await settle();
    resetCounts(counts);

    setSearchParams('unrelated', 'value');
    await settle();

    expect(counts).toEqual({
      nodeId: 0,
      location: 0,
      commentId: 0,
    });
    expect(values).toEqual({
      nodeId: 'node-1',
      location: 'loc-1',
      commentId: 'comment-1',
    });
  });

  it('notifies only the URL param consumer whose value changed', async () => {
    const { counts, values, setSearchParams } = renderHarness({
      node_id: 'node-1',
      location: 'loc-1',
      comment_id: 'comment-1',
    });
    await settle();
    resetCounts(counts);

    setSearchParams('node_id', 'node-2');
    await settle();

    expect(counts).toEqual({
      nodeId: 1,
      location: 0,
      commentId: 0,
    });
    expect(values).toEqual({
      nodeId: 'node-2',
      location: 'loc-1',
      commentId: 'comment-1',
    });
  });

  it('notifies an imperatively navigated param even when its value is unchanged', async () => {
    const { counts, values } = renderHarness({
      node_id: 'node-1',
      comment_id: 'comment-1',
    });
    await settle();
    resetCounts(counts);

    mocks.registeredMethods.goToLocationFromParams({
      comment_id: 'comment-1',
    });
    await settle();

    expect(counts).toEqual({
      nodeId: 0,
      location: 0,
      commentId: 1,
    });
    expect(values.commentId).toBe('comment-1');
  });

  it('does not notify watched params when imperative navigation uses unrelated params', async () => {
    const { counts, values } = renderHarness({
      node_id: 'node-1',
      location: 'loc-1',
      comment_id: 'comment-1',
    });
    await settle();
    resetCounts(counts);

    mocks.registeredMethods.goToLocationFromParams({
      unrelated: 'value',
    });
    await settle();

    expect(counts).toEqual({
      nodeId: 0,
      location: 0,
      commentId: 0,
    });
    expect(values).toEqual({
      nodeId: 'node-1',
      location: 'loc-1',
      commentId: 'comment-1',
    });
  });
});
