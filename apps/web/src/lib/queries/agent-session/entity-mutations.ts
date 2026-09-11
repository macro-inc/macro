import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { queryClient } from '../client';
import { previewKeys } from '../preview/keys';
import { invalidateAllSoup } from '../soup/cache';
import { agentSessionKeys } from './keys';
import { handleAgentSessionRenamed } from './session-metadata-sync';

function refreshSessionEntity(id: string) {
  invalidateAllSoup();
  void queryClient.invalidateQueries({ queryKey: agentSessionKeys._def });
  void queryClient.invalidateQueries({
    queryKey: previewKeys.item(id).queryKey,
  });
}

export async function renameAgentSession(id: string, name: string) {
  await throwOnErr(() => agentHarnessServiceClient.rename(id, name));
  handleAgentSessionRenamed({ agentSessionId: id, name });
  refreshSessionEntity(id);
}

export async function deleteAgentSession(id: string) {
  await throwOnErr(() => agentHarnessServiceClient.delete(id));
  refreshSessionEntity(id);
}
