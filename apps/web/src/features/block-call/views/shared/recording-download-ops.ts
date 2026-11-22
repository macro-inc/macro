import { t } from '@app/lib/i18n';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import type { CallRecord } from '@service-call/client';
import { indexArray } from 'solid-js';
import { callRecordingDownloadSource } from '../../queries/recording-download';

/**
 * The call menu's download items: one Download for a call with one recording,
 * or one Download part N per part of a resumed meeting.
 */
export function createRecordingDownloadOps(
  record: () => CallRecord,
  callName: () => string
): () => FileOperation[] {
  const recordingDownload = createFileDownload(() =>
    callRecordingDownloadSource(record(), callName())
  );
  // A resumed scheduled meeting has one recording per part. Keyed by index so
  // a refetch's re-signed URLs keep an in-flight download.
  const partDownloads = indexArray(
    () => (record().isActive ? [] : (record().sessions ?? [])),
    (_session, index) =>
      createFileDownload(() =>
        callRecordingDownloadSource(
          record(),
          t('calls.detailPartFileName', {
            name: callName(),
            number: index + 1,
          }),
          index
        )
      )
  );
  const downloadOps = (): FileOperation[] => {
    const parts = partDownloads();
    if (parts.length <= 1) {
      if (!record().recordingUrl) return [];
      return [
        {
          group: 'file',
          get label() {
            return t('entityActions.download');
          },
          icon: DownloadSimple,
          action: () =>
            fireAndForget(recordingDownload.start(), 'call-recording-download'),
        },
      ];
    }
    return parts.flatMap((download, index): FileOperation[] => {
      if (!record().sessions[index]?.recordingUrl) return [];
      return [
        {
          group: 'file',
          get label() {
            return t('calls.detailDownloadPart', { number: index + 1 });
          },
          icon: DownloadSimple,
          action: () =>
            fireAndForget(download.start(), 'call-recording-download'),
        },
      ];
    });
  };
  return downloadOps;
}
