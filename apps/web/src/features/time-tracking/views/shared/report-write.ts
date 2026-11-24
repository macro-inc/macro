import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { TimeWriteResult } from '../../queries/write-result';

async function report(
  write: Promise<TimeWriteResult>,
  failure: string
): Promise<void> {
  const result = await write;
  if (result.isOk()) return;
  const error = result.error;
  toast.failure(
    error.kind === 'refused' && error.code === 'FORBIDDEN'
      ? t('timeTracking.notAllowed')
      : failure
  );
}

/** Start a write; a write that does not land says so. A queued one shows at once. */
export function reportWrite(
  write: Promise<TimeWriteResult>,
  failure: string
): void {
  fireAndForget(report(write, failure), 'time-tracking-write');
}
