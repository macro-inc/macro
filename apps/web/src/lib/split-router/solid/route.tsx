import { type Component, type JSX, untrack } from 'solid-js';
import type { SplitRouteDefinition } from '../routes/types';

export type RouteProps = {
  /** Its children and component come from this element, not the definition. */
  definition: SplitRouteDefinition & {
    children?: undefined;
    component?: undefined;
  };
  component?: Component<object>;
  children?: JSX.Element;
};

const routeElement = Symbol('SplitRouter.Route');

type RouteElement = { [routeElement]: RouteProps };

/** Declares a route and the component it renders; it renders nothing itself. */
export function Route(props: RouteProps): JSX.Element {
  const element: RouteElement = { [routeElement]: props };

  return element as unknown as JSX.Element;
}

function isRouteElement(value: unknown): value is RouteElement {
  return typeof value === 'object' && value !== null && routeElement in value;
}

/** Flattens children as Solid does, calling accessors; booleans and nullish values drop out. */
function resolveChildren(children: unknown): unknown[] {
  if (typeof children === 'function' && children.length === 0) {
    return resolveChildren(children());
  }
  if (Array.isArray(children)) return children.flatMap(resolveChildren);
  if (children === undefined || children === null) return [];
  if (typeof children === 'boolean') return [];

  return [children];
}

function definitionOf(props: RouteProps): SplitRouteDefinition {
  const { definition, component } = props;

  if (definition.children || definition.component) {
    throw new Error(
      `Split route "${definition.id}" is declared with <SplitRouter.Route>, so its definition must not set children or component`
    );
  }

  const children = routeDefinitions(props.children);

  return {
    ...definition,
    ...(component ? { component } : {}),
    ...(children.length ? { children } : {}),
  };
}

/** The definitions a tree of `<SplitRouter.Route>` elements declares, read once. */
export function routeDefinitions(children: unknown): SplitRouteDefinition[] {
  return untrack(() =>
    resolveChildren(children).map((child) => {
      if (!isRouteElement(child)) {
        throw new Error(
          'Children of <SplitRouter.Router> and <SplitRouter.Route> must be <SplitRouter.Route> elements'
        );
      }

      return definitionOf(child[routeElement]);
    })
  );
}
