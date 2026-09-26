import { toast } from '@core/component/Toast/Toast';
import { setAgentSessionArchived } from '@queries/agent-session/entity-mutations';

export async function changeSessionArchiveState(
  sessionId: string,
  isArchived: boolean
): Promise<boolean> {
  try {
    await setAgentSessionArchived(sessionId, isArchived);
    toast.success(isArchived ? 'Session archived' : 'Session unarchived');
    return true;
  } catch {
    toast.failure(
      isArchived ? 'Unable to archive session' : 'Unable to unarchive session'
    );
    return false;
  }
}
