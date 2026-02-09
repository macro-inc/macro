import { useEntityPermissions } from '@queries/entity/permissions';
import { hasEntityAccess } from '@queries/entity/permissionUtils';
import { MaybeResultError } from '@core/util/maybeResult';
import { type FlowProps, Match, Switch } from 'solid-js';
import { LoadingPanel } from './LoadingSpinner';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';

function getErrorCode(error: Error | null): string | null {
  if (error instanceof MaybeResultError) {
    return error.errors[0]?.code ?? null;
  }
  return null;
}

export function BlockPermissionsGate(
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
        <div class="flex flex-col items-center justify-center h-full text-lg">
          Sorry, an unexpected error has occurred.
        </div>
      }
    >
      <Match when={query.isLoading}>
        <LoadingPanel blockId={props.entityId} />
      </Match>
      <Match when={errorCode() === 'UNAUTHORIZED'}>
        <Unauthorized />
      </Match>
      <Match when={errorCode() === 'NOT_FOUND'}>
        <NotFound />
      </Match>
      <Match when={errorCode() === 'GONE'}>
        <Gone />
      </Match>
      <Match when={query.data && !hasEntityAccess(query.data)}>
        <Unauthorized />
      </Match>
      <Match when={query.data && hasEntityAccess(query.data)}>
        {props.children}
      </Match>
    </Switch>
  );
}
