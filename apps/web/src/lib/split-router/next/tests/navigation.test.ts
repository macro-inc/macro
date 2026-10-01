import { simulate, step } from '@macro-inc/machine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runMiddleware,
  type SplitRouterMiddleware,
} from '../router/middleware';
import { IDLE, type State as RunState, runDef } from '../router/run';
import type { Navigation } from '../router/types';
import {
  type Event as GateEvent,
  type State as GateState,
  type UrlOutcome,
  urlGateDef,
} from '../router/url-gate';
import { createRoutesManifest, decodePane } from '../routes/manifest';
import type { Entry, PaneId } from '../routes/types';
import { CANCELLED } from '../utils';
import { appRoutes } from './fixtures';

const routes = createRoutesManifest(appRoutes);
const entry = (
  id: string,
  path: string,
  extra: Partial<Entry> = {}
): Entry => ({
  id,
  location: { route: decodePane(routes, path.split('/').filter(Boolean))! },
  ...extra,
});
const signal = () => new AbortController().signal;

const pane = 'p1' as PaneId;
const navigation = (id: string): Navigation => ({
  cause: 'navigate',
  targets: [{ pane, to: entry(id, '/home') }],
  apply: () => ({ status: 'committed', pane }),
});
const first = navigation('e1');
const second = navigation('e2');
const third = navigation('e4');
const entries = [entry('e3', '/mail')];

afterEach(() => vi.restoreAllMocks());

describe('run', () => {
  const guards: RunState = { t: 'guards', navigation: first };
  const middleware: RunState = { t: 'middleware', navigation: first };
  const preload: RunState = { t: 'preload', navigation: first, entries };

  it('moves from guards to middleware to preload, then commits', () => {
    const run = simulate(runDef, IDLE, [
      { t: 'navigate', navigation: first },
      { t: 'allowed' },
      { t: 'resolved', entries },
      { t: 'preloaded' },
    ]);
    expect(run.state).toEqual(IDLE);
    expect(run.commands).toEqual([{ t: 'commit', navigation: first, entries }]);
  });

  it('is turned down by guards or middleware, and fails from any phase', () => {
    expect(step(runDef, guards, { t: 'refused' })?.commands).toEqual([
      { t: 'cancel', navigation: first, reason: 'refused' },
    ]);
    expect(
      step(runDef, middleware, { t: 'middleware-cancelled' })?.commands
    ).toEqual([{ t: 'cancel', navigation: first, reason: 'cancelled' }]);
    expect(step(runDef, preload, { t: 'failed' })).toEqual({
      state: IDLE,
      commands: [{ t: 'cancel', navigation: first, reason: 'failed' }],
    });
  });

  it('ignores a report from a phase it has left', () => {
    expect(step(runDef, middleware, { t: 'allowed' })).toBeUndefined();
    expect(step(runDef, preload, { t: 'resolved', entries })).toBeUndefined();
  });

  it('lets a newer navigation replace the one in flight', () => {
    const run = simulate(runDef, IDLE, [
      { t: 'navigate', navigation: first },
      { t: 'allowed' },
      { t: 'navigate', navigation: second },
    ]);
    expect(run.state).toEqual({ t: 'guards', navigation: second });
    expect(run.commands).toEqual([
      { t: 'cancel', navigation: first, reason: 'superseded' },
    ]);
  });

  it('cancels with the reason it is aborted for', () => {
    expect(
      step(runDef, preload, { t: 'abort', reason: 'interrupted' })
    ).toEqual({
      state: IDLE,
      commands: [{ t: 'cancel', navigation: first, reason: 'interrupted' }],
    });
  });

  it('ignores reports and aborts while idle', () => {
    expect(
      step(runDef, IDLE, { t: 'abort', reason: 'superseded' })
    ).toBeUndefined();
    expect(step(runDef, IDLE, { t: 'preloaded' })).toBeUndefined();
  });
});

describe('URL gate', () => {
  const open: GateState = { t: 'open' };
  const start = (navigating: Navigation, blocking = false): GateEvent => ({
    t: 'start',
    navigation: navigating,
    blocking,
  });
  const settled = (navigating: Navigation, outcome: UrlOutcome): GateEvent => ({
    t: 'settled',
    navigation: navigating,
    outcome,
  });
  const ACTION: GateEvent = { t: 'action' };
  const LANDED: GateEvent = { t: 'revert-landed' };
  const OPENED = { t: 'opened' };
  const runs = (navigating: Navigation) => [
    { t: 'cancel-pane-runs' },
    { t: 'run', navigation: navigating },
  ];
  const revert = (navigating: Navigation) => ({
    t: 'revert',
    navigation: navigating,
  });
  const abort = (navigating: Navigation, reason: string) => ({
    t: 'abort',
    navigation: navigating,
    reason,
  });

  it('lets actions straight through while no URL navigation runs', () => {
    expect(step(urlGateDef, open, ACTION)).toEqual({
      state: open,
      commands: [OPENED],
    });
    expect(step(urlGateDef, open, start(first))?.commands).toEqual(runs(first));
  });

  it('keeps a replaced URL navigation to put back later, and its blocking', () => {
    const run = simulate(urlGateDef, open, [start(first, true), start(second)]);
    expect(run.state).toEqual({
      t: 'navigating',
      navigation: second,
      blocking: true,
      superseded: [first],
    });
    expect(run.commands).toEqual([...runs(first), ...runs(second)]);
  });

  it('opens once the current URL navigation commits, forgetting the ones it replaced', () => {
    const run = simulate(urlGateDef, open, [
      start(first),
      start(second),
      settled(second, 'committed'),
    ]);
    expect(run.state).toEqual(open);
    expect(run.commands).toEqual([...runs(first), ...runs(second), OPENED]);
  });

  it.each(['refused', 'cancelled'] as const)(
    'puts back a %s URL navigation, then the ones it replaced, newest first',
    (outcome) => {
      const run = simulate(urlGateDef, open, [
        start(first),
        start(second),
        start(third),
        settled(third, outcome),
        LANDED,
        LANDED,
        LANDED,
      ]);
      expect(run.state).toEqual(open);
      expect(run.commands.slice(6)).toEqual([
        revert(third),
        revert(second),
        revert(first),
        OPENED,
      ]);
    }
  );

  it('opens after a failed URL navigation without putting its URL back', () => {
    const run = simulate(urlGateDef, open, [
      start(first),
      settled(first, 'failed'),
    ]);
    expect(run.state).toEqual(open);
    expect(run.commands).toEqual([...runs(first), OPENED]);
  });

  it('ignores the outcome of a URL navigation that is no longer current', () => {
    const navigating: GateState = {
      t: 'navigating',
      navigation: second,
      blocking: false,
      superseded: [first],
    };
    expect(
      step(urlGateDef, navigating, settled(first, 'committed'))
    ).toBeUndefined();
  });

  it('holds an action while a blocking URL navigation runs', () => {
    const blocking: GateState = {
      t: 'navigating',
      navigation: first,
      blocking: true,
      superseded: [],
    };
    expect(step(urlGateDef, blocking, ACTION)).toBeUndefined();
  });

  it('lets an action take over from any other URL navigation once its URLs are back', () => {
    const run = simulate(urlGateDef, open, [
      start(first),
      start(second),
      ACTION,
      LANDED,
      LANDED,
    ]);
    expect(run.state).toEqual(open);
    expect(run.commands.slice(4)).toEqual([
      abort(second, 'interrupted'),
      revert(second),
      revert(first),
      OPENED,
    ]);
  });

  it('turns away a URL navigation that arrives while reverting and puts it back too', () => {
    const run = simulate(urlGateDef, open, [
      start(first),
      ACTION,
      start(second),
      LANDED,
      LANDED,
    ]);
    expect(run.state).toEqual(open);
    expect(run.commands.slice(2)).toEqual([
      abort(first, 'interrupted'),
      revert(first),
      abort(second, 'interrupted'),
      revert(second),
      OPENED,
    ]);
  });

  it('puts back a URL navigation arriving mid-revert before the older ones still queued', () => {
    const run = simulate(urlGateDef, open, [
      start(first),
      start(second),
      settled(second, 'refused'),
      start(third),
      LANDED,
      LANDED,
      LANDED,
    ]);
    const reverts = run.commands.filter((command) => command.t === 'revert');

    expect(run.state).toEqual(open);
    expect(reverts).toEqual([revert(second), revert(third), revert(first)]);
  });

  it('aborts the URL navigation and opens on dispose, then turns everything away', () => {
    const run = simulate(urlGateDef, open, [
      start(first, true),
      { t: 'dispose' },
      ACTION,
      start(second),
    ]);
    expect(run.state).toEqual({ t: 'disposed' });
    expect(run.commands.slice(2)).toEqual([
      abort(first, 'disposed'),
      OPENED,
      OPENED,
      abort(second, 'disposed'),
    ]);
  });
});

describe('middleware', () => {
  const navigatingTo = (to: Entry) => ({
    to,
    cause: 'navigate' as const,
    signal: signal(),
  });

  it('follows redirects and keeps the entry identity', () => {
    const middleware: SplitRouterMiddleware = ({ to, redirect }) =>
      to.location.route.matches[0].id === 'block'
        ? redirect('/mail/t1')
        : undefined;
    const result = runMiddleware(
      routes,
      [middleware],
      navigatingTo(entry('e1', '/md/d1'))
    );
    expect(result).toMatchObject({
      id: 'e1',
      location: { route: { matches: [{ id: 'mail' }, { id: 'mail-thread' }] } },
    });
  });

  it('cancels when a handler asks to', () => {
    const result = runMiddleware(
      routes,
      [({ cancel }) => cancel()],
      navigatingTo(entry('e1', '/home'))
    );
    expect(result).toBe(CANCELLED);
  });

  it('awaits async handlers', async () => {
    const result = runMiddleware(
      routes,
      [
        async ({ path, redirect }) =>
          path === '/drive' ? undefined : redirect('/drive'),
      ],
      navigatingTo(entry('e1', '/home'))
    );
    await expect(result).resolves.toMatchObject({
      location: { route: { matches: [{ id: 'drive' }] } },
    });
  });

  it('falls back to the proposed entry on a redirect loop', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = entry('e1', '/home');
    const result = runMiddleware(
      routes,
      [
        ({ to, redirect }) =>
          redirect(
            to.location.route.matches[0].id === 'home' ? '/drive' : '/home'
          ),
      ],
      navigatingTo(original)
    );
    expect(result).toBe(original);
    expect(error).toHaveBeenCalled();
  });
});
