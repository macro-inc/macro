import type { GeofencePermission } from '@core/mobile/native-geofence';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';

function permissionMessage(permission: GeofencePermission): string {
  return match(permission)
    .with('always', () => 'Location access is set to Always.')
    .with(
      'when_in_use',
      () =>
        'Location access is set to While Using. Choose Always so places work while Macro is closed.'
    )
    .with('not_determined', () => 'Macro needs location access set to Always.')
    .with(
      'denied',
      () =>
        'Location access is off. Turn it on for Macro in Settings, and choose Always.'
    )
    .with('unsupported', () => 'This phone can’t watch places.')
    .exhaustive();
}

/** This phone's location access, with a way to allow it while the system can still ask. */
export function RoutinePlaceAccess(props: {
  permission: GeofencePermission | undefined;
  requesting: boolean;
  onRequest: () => void;
}) {
  const canAsk = (permission: GeofencePermission) =>
    permission === 'not_determined' || permission === 'when_in_use';
  return (
    <Show when={props.permission}>
      {(permission) => (
        <div class="grid gap-2">
          <p
            role="status"
            class={cn(
              'text-xs leading-4',
              permission() === 'always' ? 'text-ink-muted' : 'text-ink'
            )}
          >
            {permissionMessage(permission())}
          </p>
          <Show when={canAsk(permission())}>
            <Button
              variant="secondary"
              size="sm"
              class="justify-self-start"
              disabled={props.requesting}
              onClick={() => props.onRequest()}
            >
              Allow location access
            </Button>
          </Show>
        </div>
      )}
    </Show>
  );
}
