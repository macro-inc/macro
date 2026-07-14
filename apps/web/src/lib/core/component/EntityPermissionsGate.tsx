import { ThrownResultError } from '@core/util/result';
import { useEntityPermissions } from '@queries/entity/permissions';
import { hasEntityAccess } from '@queries/entity/permissionUtils';
import { type FlowProps, Match, Show, Suspense, Switch } from 'solid-js';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';
import { LoadingBlock } from './LoadingBlock';

function getErrorCode(error: Error | null): string | null {
  if (error instanceof ThrownResultError) {
    return error.errors[0]?.code ?? null;
  }
  return null;
}

function PermissionGateInner(
  props: FlowProps<{ entityType: string; entityId: string }>
) {
  const query = useEntityPermissions(
    () => props.entityType,
    () => props.entityId
  );

  const errorCode = () => getErrorCode(query.error);

  return (
    <Switch
      fallback={
        <Show
          when={query.data && hasEntityAccess(query.data)}
          fallback={<Unauthorized />}
        >
          {props.children}
        </Show>
      }
    >
      <Match when={errorCode() === 'UNAUTHORIZED'}>
        <Unauthorized />
      </Match>
      <Match when={errorCode() === 'NOT_FOUND'}>
        <NotFound />
      </Match>
      <Match when={errorCode() === 'GONE'}>
        <Gone />
      </Match>
      <Match when={query.error}>
        <div class="flex flex-col items-center justify-center h-full text-lg">
          Sorry, an unexpected error has occurred.
        </div>
      </Match>
    </Switch>
  );
}

export function EntityPermissionsGate(
  props: FlowProps<{ entityType: string; entityId: string }>
) {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <PermissionGateInner {...props} />
    </Suspense>
  );
}
