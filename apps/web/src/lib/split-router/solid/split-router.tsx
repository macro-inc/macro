import type { SplitRouter as RouterInstance } from '../router/create-router';
import { SplitRouterProvider } from './context';
import { Outlet } from './outlet';
import { PaneScope } from './pane-scope';
import { Route } from './route';
import { Router } from './router';

export type SplitRouter = RouterInstance;

/**
 * `Router` creates a router from its `Route` children; `Root` provides one
 * created with `createSplitRouter`. `Scope` binds a subtree to a pane, and
 * `Outlet` renders the pane's route.
 */
export const SplitRouter = {
  Router,
  Route,
  Root: SplitRouterProvider,
  Scope: PaneScope,
  Outlet,
};
