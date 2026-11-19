import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableAgentPermissions,
  enableJsToolsCodeMode,
  enableOcamlCodeMode,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether agent permissions are shown: they gate the programs the harness
 * can check (OCaml and JS tools), so the permissions flag and at least one
 * of those languages' flags must be on. The API also answers 404 otherwise,
 * and every surface hides then too.
 */
export function useAgentPermissionsFlag(): Accessor<boolean> {
  const permissions = useFeatureFlag(enableAgentPermissions);
  const ocaml = useFeatureFlag(enableOcamlCodeMode);
  const jsTools = useFeatureFlag(enableJsToolsCodeMode);
  return () => permissions().enabled && (ocaml().enabled || jsTools().enabled);
}
