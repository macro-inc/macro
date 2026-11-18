import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableAgentPermissions,
  enableOcamlCodeMode,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether agent permissions are shown: they build on OCaml code mode, so
 * both flags must be on. The API also answers 404 while either is off for
 * the caller, and every surface hides then too.
 */
export function useAgentPermissionsFlag(): Accessor<boolean> {
  const permissions = useFeatureFlag(enableAgentPermissions);
  const ocaml = useFeatureFlag(enableOcamlCodeMode);
  return () => permissions().enabled && ocaml().enabled;
}
