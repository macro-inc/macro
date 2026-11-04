import { toast } from '@core/component/Toast/Toast';
import { setAgentSessionArchived } from '@queries/agent-session/entity-mutations';

export async function changeSessionArchiveState(
  sessionId: string,
  archived: boolean
): Promise<boolean> {
  try {
    await setAgentSessionArchived(sessionId, archived);
    toast.success(archived ? 'Session archived' : 'Session unarchived');
    return true;
  } catch {
    toast.failure(
      archived ? 'Unable to archive session' : 'Unable to unarchive session'
    );
    return false;
  }
}
