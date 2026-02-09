import { useEntityPermissions } from '@queries/entity/permissions';
import { hasEntityAccess } from '@queries/entity/permissionUtils';
import { MaybeResultError } from '@core/util/maybeResult';
import { type FlowProps, Show, Suspense } from 'solid-js';
import { ErrorBoundary } from 'solid-js/web';
import { LoadingBlock } from './LoadingBlock';
import Gone from './AccessErrorViews/Gone';
import NotFound from './AccessErrorViews/NotFound';
import Unauthorized from './AccessErrorViews/Unauthorized';

function PermissionErrorFallback(props: { error: Error }) {
  if (props.error instanceof MaybeResultError) {
    const code = props.error.errors[0]?.code;
    if (code === 'UNAUTHORIZED') return <Unauthorized />;
    if (code === 'NOT_FOUND') return <NotFound />;
    if (code === 'GONE') return <Gone />;
  }

  return (
    <div class="flex flex-col items-center justify-center h-full text-lg">
      Sorry, an unexpected error has occurred.
    </div>
  );
}

function PermissionGateInner(
  props: FlowProps<{ entityType: string; entityId: string }>
) {
  const query = useEntityPermissions(
    () => props.entityType,
    () => props.entityId
  );

  return (
    <Show when={query.data && hasEntityAccess(query.data)} fallback={<Unauthorized />}>
      {props.children}
    </Show>
  );
}

export function BlockPermissionsGate(
  props: FlowProps<{ entityType: string; entityId: string }>
) {
  return (
    <ErrorBoundary fallback={(error) => <PermissionErrorFallback error={error} />}>
      <Suspense fallback={<LoadingBlock />}>
        <PermissionGateInner {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
