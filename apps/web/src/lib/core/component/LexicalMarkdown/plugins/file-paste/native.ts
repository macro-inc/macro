import {
  recoverMobileClipboardImageEntries,
  shouldUseMobileClipboardImageRecovery,
} from '@core/mobile/mobileClipboardImageRecovery';
import { extractFileSystemEntries } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  shouldStageDesktopPasteFiles,
  stageDesktopPasteFiles,
} from './desktopPasteboardFiles';

/** File transport runs only after the native priority bus chooses file paste. */
export function registerNativeFilePaste(
  view: EditorView,
  options: {
    onPasteFilesAndDirs(
      files: FileSystemFileEntry[],
      directories: FileSystemDirectoryEntry[]
    ): void;
  }
): () => void {
  let nextRequest = 0;
  let active = true;
  const pending = new Map<
    number,
    {
      files: File[];
      entries: FileSystemFileEntry[];
      directories: FileSystemDirectoryEntry[];
      mobile: boolean;
      generation: number | null;
    }
  >();
  const releaseFacts = view.clipboard.registerFacts((clipboard) => {
    const { fileEntries, directoryEntries } =
      extractFileSystemEntries(clipboard);
    const mobile =
      directoryEntries.length === 0 &&
      shouldUseMobileClipboardImageRecovery(clipboard);
    const hasFiles =
      fileEntries.length > 0 ||
      directoryEntries.length > 0 ||
      clipboard.files.length > 0;
    const request = hasFiles || mobile ? ++nextRequest : 0;
    if (request)
      pending.set(request, {
        files: Array.from(clipboard.files),
        entries: fileEntries,
        directories: directoryEntries,
        mobile,
        generation: view.mirror.keyGeneration,
      });
    return {
      entries: [
        {
          mime: 'application/x-macro-paste-facts',
          value: JSON.stringify({
            request,
            hasFileEntries: hasFiles,
            mobileImageRecovery: mobile,
          }),
        },
      ],
      release: () => {
        pending.delete(request);
      },
    };
  });
  const releaseEvent = view.onPluginEvent('group-b.file-paste', (payload) => {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('request' in payload) ||
      typeof payload.request !== 'number'
    )
      return;
    const request = pending.get(payload.request);
    pending.delete(payload.request);
    if (
      !request ||
      !active ||
      !view.isMounted ||
      view.root.contentEditable !== 'true'
    )
      return;
    const current = () =>
      active &&
      view.isMounted &&
      view.root.contentEditable === 'true' &&
      view.mirror.keyGeneration === request.generation;
    fireAndForget(
      Telemetry.span('editor.file-paste', async (span) => {
        span.setAttr('files.count', request.entries.length);
        span.setAttr('directories.count', request.directories.length);
        if (request.mobile) {
          const entries = await span.span('clipboard.recover', () =>
            recoverMobileClipboardImageEntries()
          );
          if (!current()) return;
          const recovered = entries.length > 0 ? entries : request.entries;
          if (recovered.length)
            span.run(() => options.onPasteFilesAndDirs(recovered, []));
        } else if (request.directories.length) {
          span.run(() => options.onPasteFilesAndDirs([], request.directories));
        } else if (shouldStageDesktopPasteFiles(request.files)) {
          const staged = await span.span('clipboard.stage', () =>
            stageDesktopPasteFiles(request.files)
          );
          if (current())
            span.run(() => options.onPasteFilesAndDirs(staged, []));
        } else {
          span.run(() => options.onPasteFilesAndDirs(request.entries, []));
        }
      }),
      'editor.file-paste'
    );
  });
  return () => {
    active = false;
    pending.clear();
    releaseFacts();
    releaseEvent();
  };
}
