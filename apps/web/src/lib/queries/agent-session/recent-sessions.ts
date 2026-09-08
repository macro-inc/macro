import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createEffect, createSignal, untrack } from 'solid-js';

export type RecentAgentSession = {
  id: string;
  name: string;
  modifiedAt: string;
};

const [workingSessions, setWorkingSessions] = createSignal<
  Record<string, boolean>
>({});
export const isRecentAgentSessionWorking = (id: string) =>
  workingSessions()[id] ?? false;
export function setRecentAgentSessionWorking(id: string, working: boolean) {
  setWorkingSessions((previous) =>
    previous[id] === working ? previous : { ...previous, [id]: working }
  );
}

const storage = createUserScopedStorage('recent-agent-sessions');
const [accounts, setAccounts] = createSignal<
  Record<string, RecentAgentSession[]>
>({});

function load(userId: string): RecentAgentSession[] {
  const cached = untrack(accounts)[userId];
  if (cached) return cached;
  let sessions: RecentAgentSession[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.read(userId) ?? '[]');
    if (Array.isArray(parsed)) {
      sessions = parsed.filter(
        (item): item is RecentAgentSession =>
          typeof item?.id === 'string' &&
          typeof item?.name === 'string' &&
          typeof item?.modifiedAt === 'string'
      );
    }
  } catch {
    /* A damaged local cache must not prevent opening the view. */
  }
  setAccounts((previous) => ({ ...previous, [userId]: sessions }));
  return sessions;
}

/** Remember sessions created or opened here until sessions have a server list API. */
export function rememberAgentSession(
  userId: string,
  session: RecentAgentSession
) {
  const previous = load(userId);
  const existing = previous.find((item) => item.id === session.id);
  if (
    existing?.name === session.name &&
    existing.modifiedAt === session.modifiedAt
  )
    return;
  const entry = {
    id: session.id,
    name: session.name,
    modifiedAt: session.modifiedAt,
  };
  const next = [entry, ...previous.filter((item) => item.id !== session.id)]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 200);
  setAccounts((current) => ({ ...current, [userId]: next }));
  storage.write(userId, JSON.stringify(next));
}

/** Load only the signed-in user's local session history; no resource reads. */
export function useRecentAgentSessions() {
  const userId = useUserId();
  createEffect(() => {
    const id = userId();
    if (id) load(id);
  });
  return () => accounts()[userId() ?? ''] ?? [];
}
