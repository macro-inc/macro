import { useUserId } from '@core/context/user';
import { useClaudeConnectionSource } from '@queries/claude-auth/connection';
import { Suspense } from 'solid-js';
import { ConnectionCard } from './components/connection-card';
import { openClaudeSignIn } from './open-sign-in';
import { createClaudeConnection } from './primitives/connection';

function ConnectedCard() {
  const connection = createClaudeConnection(
    useClaudeConnectionSource(useUserId()),
    openClaudeSignIn
  );
  return (
    <ConnectionCard
      status={connection.status()}
      failed={connection.failed()}
      login={connection.login()}
      code={connection.code()}
      busy={connection.busy()}
      error={connection.error()}
      onCode={connection.setCode}
      onBegin={() => void connection.begin()}
      onComplete={() => void connection.complete()}
      onDisconnect={() => void connection.disconnect()}
      onRefresh={() => void connection.refresh()}
    />
  );
}

/** Production composition, isolated from the parent Settings suspense boundary. */
export function ClaudeConnection() {
  return (
    <Suspense
      fallback={
        <p class="text-sm text-ink-muted">Loading Claude connection…</p>
      }
    >
      <ConnectedCard />
    </Suspense>
  );
}
