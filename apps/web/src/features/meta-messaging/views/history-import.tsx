import type { MetaConnection } from '@service-storage/generated/schemas/metaConnection';
import { HistoryImportControl } from '../components/history-import';
import { useHistoryImport } from '../queries/history-import';

export function AccountHistoryImport(props: { connection: MetaConnection }) {
  const { query, start } = useHistoryImport(
    () => props.connection.id,
    () => `${props.connection.connected_at ?? ''}:${props.connection.status}`,
    () => props.connection.status === 'connected'
  );
  const view = () => (query.isSuccess ? query.data : undefined);
  return (
    <HistoryImportControl
      provider={props.connection.provider}
      accountName={props.connection.display_name.trim()}
      ready={query.isSuccess}
      canImport={view()?.can_import ?? false}
      reason={view()?.reason}
      job={view()?.import}
      pending={start.isPending}
      error={
        query.isError
          ? 'History options couldn’t load. Try again.'
          : start.isError
            ? 'The import couldn’t start. Refresh the account status and try again.'
            : undefined
      }
      onRefresh={() => void query.refetch()}
      onImport={() => start.mutate()}
    />
  );
}
