import { SplitRouter as SplitRouterComponents } from './solid';
import type { SplitRouter as SplitRouterContract } from './types';

export type SplitRouter<TSplitId> = SplitRouterContract<TSplitId>;

export const SplitRouter = SplitRouterComponents;

export {
  type CreateSearchParamsOptions,
  createSearchParams,
  type SetSearchParams,
  type SetSearchParamsOptions,
} from './create-search-params';
export {
  createMemorySplitRouterLocation,
  type MemorySplitRouterLocation,
} from './integrations/memory';
export {
  createSolidRouterLocation,
  type SolidRouterLocationOptions,
} from './integrations/solid-router';
export { runSplitRouterMiddleware } from './middleware';
export type { RoutePattern } from './path';
export { createSplitRouter } from './router';
export {
  createRoutesManifest,
  decodeRoute,
  defineRoute,
  defineRoutes,
  encodeRoute,
  filterRouteSearch,
  getExternalSearchKeys,
  getRouteClaim,
  getRouteId,
  getRouteSearchNamespaces,
  type RouteParamsCodec,
  resolveRouteBranch,
  rootRouteMatch,
  routeParams,
  type SplitRouteNode,
  type SplitRoutesManifest,
  validateSplitRoutes,
} from './routes';
export {
  createSearchParamsCodec,
  type SearchParamsCodec,
  type SearchParamsCodecOptions,
  type SearchParamsDeserializer,
  type SearchParamsSchema,
  type SearchParamsSerializer,
} from './search-params-codec';
export {
  Outlet,
  Root,
  Scope,
  type SplitRouterOutletProps,
  type SplitRouterRootProps,
  type SplitRouterScopeProps,
  useCanGo,
  useNavigate,
  useParams,
  useRouteParams,
  useSplitHistory,
  useSplitRouter,
} from './solid';
export type {
  BrowserHistoryIntent,
  DefinedSplitRoute,
  DefinedSplitRoutes,
  InferSplitRouteBranchParams,
  InferSplitRouteNavigationParams,
  InferSplitRouteParams,
  SerializedSearchParams,
  SplitLocation,
  SplitNavigate,
  SplitNavigateOptions,
  SplitNavigateTo,
  SplitNonRouteNavigateTo,
  SplitParentNavigationTarget,
  SplitRouteClaim,
  SplitRouteDefinition,
  SplitRouteMatch,
  SplitRouteNavigationTarget,
  SplitRouteParams,
  SplitRouteRawParams,
  SplitRouterEntry,
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
  SplitRouterHistorySnapshot,
  SplitRouterLayout,
  SplitRouterLayoutEntry,
  SplitRouterLayoutSnapshot,
  SplitRouterMiddleware,
  SplitRouterMiddlewareConfig,
  SplitRouterMiddlewareContext,
  SplitRouterMiddlewareRedirect,
  SplitRouterMiddlewareRequest,
  SplitRouterMiddlewareResult,
  SplitRouterMiddlewareRun,
  SplitRouterNavigationCause,
  SplitRouterOptions,
  SplitRouterSettledChange,
  SplitRouteState,
  SplitRoutes,
  SplitRouteUnion,
  SplitSearchState,
  SplitSearchUpdate,
  SplitSearchUpdateOptions,
  UnmatchedSplitPathContext,
  UnmatchedSplitPathHandler,
} from './types';
export {
  type DecodedSplitRouterLocation,
  decodeRouteLayout,
  decodeSplitRouterLocation,
  encodeRouteLayout,
  externalLocationToString,
  formatRoutePathname,
  parseExternalLocation,
  parseRoutePathname,
  SPLIT_PATH_SEPARATOR,
  serializeSplitRouterLocation,
} from './url';
export { isSafeName, takeLast } from './utils';
