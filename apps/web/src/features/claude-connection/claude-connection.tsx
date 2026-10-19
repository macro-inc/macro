import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
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
      onBegin={() => fireAndForget(connection.begin(), 'claude-connection')}
      onComplete={() =>
        fireAndForget(connection.complete(), 'claude-connection')
      }
      onDisconnect={() =>
        fireAndForget(connection.disconnect(), 'claude-connection')
      }
      onRefresh={() => fireAndForget(connection.refresh(), 'claude-connection')}
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
