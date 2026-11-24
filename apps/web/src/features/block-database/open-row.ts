import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { ReferredFrom } from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';

export type DatabaseRowTarget = {
  databaseId: string;
  tableId: string;
  rowId: string;
};

/**
 * Opens a row's database and reveals the row there, or in its record panel
 * when no open view lists it.
 */
export function openDatabaseRow(
  target: DatabaseRowTarget,
  options: { openInNewSplit?: boolean; referredFrom?: ReferredFrom } = {}
): Promise<void> {
  return Telemetry.span('database.row.open', async (span) => {
    span.setAttr('database.id', target.databaseId);
    span.setAttr('database.table_id', target.tableId);
    span.setAttr('database.row_id', target.rowId);
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    splitManager.openWithSplit(
      { type: 'database', id: target.databaseId },
      {
        activate: true,
        preferNewSplit: options.openInNewSplit,
        referredFrom: options.referredFrom,
      }
    );
    try {
      const handle = await splitManager
        .getOrchestrator()
        .getBlockHandle(target.databaseId, 'database');
      await handle?.goToLocationFromParams({
        tableId: target.tableId,
        rowId: target.rowId,
      });
    } catch (error) {
      span.error(error);
      toast.failure(t('commandMenu.databaseRowOpenFailed'));
    }
  });
}
