import { toast } from '@core/component/Toast/Toast';
import {
  useBeginCodexLogin,
  useCancelCodexLogin,
  useCodexEnvironmentsQuery,
  useCodexLoginQuery,
  useCodexStatusQuery,
  useConfigureCodex,
  useDisconnectCodex,
} from '@queries/auth/codex';
import { createSignal, Show, Suspense } from 'solid-js';
import { CodexConnection } from '../components/CodexConnection';

export function CodexHarness() {
  return (
    <Suspense>
      <CodexHarnessContent />
    </Suspense>
  );
}
function CodexHarnessContent() {
  const connection = useCodexStatusQuery();
  const begin = useBeginCodexLogin();
  const cancel = useCancelCodexLogin();
  const disconnect = useDisconnectCodex();
  const configure = useConfigureCodex();
  const [attempt, setAttempt] =
    createSignal<Awaited<ReturnType<typeof begin.mutateAsync>>>();
  const [error, setError] = createSignal<string>();
  const status = useCodexLoginQuery(attempt);
  const connected = () => connection.isSuccess && connection.data.connected;
  const environments = useCodexEnvironmentsQuery(connected);
  const startLogin = async () => {
    setError(undefined);
    try {
      setAttempt(await begin.mutateAsync());
    } catch {
      setError('Could not start ChatGPT sign-in. Please try again.');
    }
  };
  const cancelLogin = async () => {
    const current = attempt();
    if (!current) return;
    setError(undefined);
    try {
      await cancel.mutateAsync(current.attemptId);
      setAttempt(undefined);
    } catch {
      setError('Could not cancel sign-in. Please try again.');
    }
  };
  const disconnectAccount = async () => {
    setError(undefined);
    try {
      await disconnect.mutateAsync();
      setAttempt(undefined);
      toast.success('ChatGPT disconnected');
    } catch {
      setError('Could not disconnect ChatGPT. Please try again.');
    }
  };
  const save = async (config: { environmentId: string }) => {
    setError(undefined);
    try {
      await configure.mutateAsync(config);
      toast.success('Codex settings saved');
    } catch {
      setError(
        'Could not save Codex settings. Check the environment, then retry.'
      );
    }
  };
  return (
    <Show
      when={
        connection.isSuccess && connection.data.connected
          ? (connection.data.accountId ?? 'connected')
          : 'disconnected'
      }
      keyed
    >
      {(_account) => (
        <CodexConnection
          connection={
            connection.isSuccess && !connection.isPlaceholderData
              ? connection.data
              : undefined
          }
          loading={connection.isPending || connection.isPlaceholderData}
          login={
            attempt()
              ? {
                  ...attempt()!,
                  status: status.isSuccess ? status.data.status : 'pending',
                }
              : undefined
          }
          environments={environments.isSuccess ? environments.data : []}
          environmentsLoading={environments.isPending}
          environmentsError={environments.isError}
          pending={
            begin.isPending ||
            cancel.isPending ||
            disconnect.isPending ||
            configure.isPending
          }
          error={
            error() ??
            (connection.isError
              ? 'Could not load your Codex connection. Refresh to retry.'
              : status.isError
                ? 'Could not check sign-in. Cancel and try again.'
                : undefined)
          }
          onConnect={() => void startLogin()}
          onCancel={() => void cancelLogin()}
          onDisconnect={() => void disconnectAccount()}
          onRetryEnvironments={() => void environments.refetch()}
          onSave={(config) => void save(config)}
        />
      )}
    </Show>
  );
}
