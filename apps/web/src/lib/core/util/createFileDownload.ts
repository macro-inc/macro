import { toast } from '@core/component/Toast/Toast';
import { exportAndroidFileWithProgress } from '@core/mobile/exportAndroidFileWithProgress';
import { exportIosFile, hasIosFileExport } from '@core/mobile/iosFiles';
import { isPlatform } from '@core/util/platform';
import type { ResultError } from '@core/util/result';
import { downloadFile } from '@filesystem/download';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { FetchProgress } from '@service-storage/util/fetchPresigned';
import type { Result } from 'neverthrow';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

export type DownloadSource = {
  id: string;
  name: string;
  load: (options: {
    signal: AbortSignal;
    onProgress: (progress: FetchProgress) => void;
    span: Span;
  }) => Promise<Result<{ blob: Blob; name?: string }, ResultError<string>[]>>;
};

export function createFileDownload(
  source: Accessor<DownloadSource | undefined>
) {
  const [phase, setPhase] = createSignal<
    'idle' | 'loading' | 'ready' | 'saving' | 'error'
  >('idle');
  const [action, setAction] = createSignal<'save' | 'share'>('save');
  let nativeIos = false;
  const [file, setFile] = createSignal<File>();
  const [name, setName] = createSignal('');
  const [progress, setProgress] = createSignal<FetchProgress>({
    loaded: 0,
    total: 0,
  });
  let controller: AbortController | undefined;
  const isCurrent = (request: AbortController) =>
    controller === request && !request.signal.aborted;
  let selectedId: string | undefined;
  let trace: Span | undefined;
  const finishTrace = (outcome: string, error?: unknown) => {
    if (error !== undefined) trace?.error(error);
    trace?.setAttr('file.outcome', outcome);
    trace?.end();
    trace = undefined;
  };
  let opener: HTMLElement | undefined;
  const restoreFocus = () => {
    if (opener?.isConnected) opener.focus();
  };

  const cancel = () => {
    finishTrace('canceled');
    controller?.abort();
    controller = undefined;
    setFile(undefined);
    setPhase('idle');
  };
  onCleanup(cancel);
  // Abort the external transfer when the viewer changes file or version.
  createEffect(on(() => source()?.id, cancel, { defer: true }));

  const busy = () => phase() === 'loading' || phase() === 'saving';
  const canOfferShare = () =>
    isPlatform('android') ||
    isPlatform('ios') ||
    typeof navigator.share === 'function';
  const canShare = () => {
    const ready = file();
    return (
      !!ready &&
      (isPlatform('android') ||
        nativeIos ||
        !!navigator.canShare?.({ files: [ready] }))
    );
  };

  // A prepared Web Share file can be handed off from the original control on
  // a fresh tap if loading outlived the browser's user activation.
  const handOff = async (action: 'save' | 'share') => {
    const ready = file();
    const request = controller;
    if (!ready || !request || request.signal.aborted || phase() === 'saving')
      return;
    if (source()?.id !== selectedId) {
      cancel();
      return;
    }
    setPhase('saving');
    // A cancelled chooser can be retried with the already prepared bytes.
    trace ??= Telemetry.span('file.download');
    trace.setAttr('file.id', selectedId ?? '');
    trace.setAttr('file.size', ready.size);
    const span = trace.span(`file.${action}`);
    try {
      await span.run(async () => {
        let canceled = false;
        if (isPlatform('android')) {
          ({ canceled } = await exportAndroidFileWithProgress(
            ready,
            ready.name,
            action,
            request.signal
          ));
        } else if (nativeIos) {
          ({ canceled } = await exportIosFile(ready, action, {
            signal: request.signal,
            onProgress: (fraction) => {
              if (controller === request)
                setProgress({
                  loaded: fraction * ready.size,
                  total: ready.size,
                });
            },
          }));
        } else if (action === 'share' || isPlatform('ios')) {
          await navigator.share({ files: [ready] });
        } else {
          const { saved } = await downloadFile(ready, ready.name);
          if (!saved) {
            span.error('Unable to save file');
            if (controller === request) {
              setPhase('ready');
              finishTrace('failed', 'Unable to save file');
            }
            return;
          }
        }
        span.setAttr('file.outcome', canceled ? 'canceled' : 'handed_off');
        if (controller !== request) return;
        if (canceled) {
          finishTrace('canceled');
          setPhase('ready');
          return;
        }
        if (action === 'save' && (!isPlatform('ios') || nativeIos)) {
          toast.success(
            isPlatform('android') || nativeIos
              ? 'File saved'
              : 'Download started'
          );
        }
        finishTrace('handed_off');
        cancel();
        restoreFocus();
      });
    } catch (error) {
      const canceled =
        request.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      if (canceled) span.setAttr('file.outcome', 'canceled');
      else span.error(error);
      if (controller !== request) return;
      setPhase('ready');
      finishTrace(
        canceled ? 'canceled' : 'failed',
        canceled ? undefined : error
      );
      if (canceled) return;
      Telemetry.error(error, { surface: 'file-download' });
      toast.failure(
        action === 'share' ? 'Unable to share file' : 'Unable to download file',
        {
          subtext: 'Please try again.',
        }
      );
    } finally {
      span.end();
    }
  };

  const handOffWhenReady = async (nextAction: 'save' | 'share') => {
    const usesWebShare =
      !nativeIos &&
      !isPlatform('android') &&
      (nextAction === 'share' || isPlatform('ios'));
    if (usesWebShare) {
      if (!canShare()) {
        setPhase('error');
        finishTrace('unsupported');
        toast.failure('This device can’t share this file');
        return;
      }
      if (!navigator.userActivation?.isActive) {
        toast.custom({
          title:
            nextAction === 'share'
              ? 'File ready — tap Share'
              : 'File ready — tap Save file',
        });
        return;
      }
    }
    await handOff(nextAction);
  };

  const start = async (nextAction: 'save' | 'share' = 'save') => {
    if (busy()) return;
    if (document.activeElement instanceof HTMLElement)
      opener = document.activeElement;
    if (phase() === 'ready' && file() && source()?.id === selectedId) {
      setAction(nextAction);
      await handOff(nextAction);
      return;
    }
    const snapshot = source();
    if (!snapshot) return;
    const request = new AbortController();
    batch(() => {
      cancel();
      selectedId = snapshot.id;
      controller = request;
      setName(snapshot.name);
      setProgress({ loaded: 0, total: 0 });
      setPhase('loading');
      setAction(nextAction);
    });
    trace = Telemetry.span('file.download');
    trace.setAttr('file.id', snapshot.id);
    trace.setAttr('file.action', nextAction);
    const span = trace.span('file.load');
    try {
      nativeIos = isPlatform('ios') && (await hasIosFileExport());
      if (!isCurrent(request)) {
        span.end();
        return;
      }
      const result = await span.run(async () => {
        try {
          const result = await snapshot.load({
            signal: request.signal,
            span,
            onProgress: (next) => {
              if (controller === request) setProgress(next);
            },
          });
          if (result.isErr() && !request.signal.aborted)
            span.error(result.error);
          return result;
        } catch (error) {
          if (request.signal.aborted) span.setAttr('file.outcome', 'canceled');
          else span.error(error);
          throw error;
        } finally {
          span.end();
        }
      });
      if (!isCurrent(request)) return;
      if (source()?.id !== snapshot.id) {
        cancel();
        return;
      }
      if (result.isErr()) {
        setPhase('error');
        finishTrace('failed', result.error);
        toast.failure('Unable to download file', {
          subtext: 'Try again. The file may no longer be available.',
        });
        return;
      }
      const filename = result.value.name || snapshot.name;
      trace?.setAttr('file.size', result.value.blob.size);
      setName(filename);
      setFile(
        new File([result.value.blob], filename, {
          type: result.value.blob.type,
        })
      );
      setPhase('ready');
      await handOffWhenReady(nextAction);
    } catch (error) {
      if (!isCurrent(request)) return;
      setPhase('error');
      finishTrace('failed', error);
      Telemetry.error(error, { surface: 'file-download' });
      toast.failure('Unable to download file', {
        subtext: 'Try again. The file may no longer be available.',
      });
    }
  };

  return {
    start,
    cancel,
    action,
    phase,
    busy,
    file,
    name,
    progress,
    canOfferShare,
  };
}

export type FileDownloadController = ReturnType<typeof createFileDownload>;
