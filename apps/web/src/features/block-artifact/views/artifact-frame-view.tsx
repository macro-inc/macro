import { liveThemeMode } from '@app/features/theme/signals/themeSignals';
import { t } from '@app/lib/i18n';
import { TraceFlow, usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui/components/Button';
import { Spinner } from '@ui/components/Spinner';
import { Match, Show, Switch } from 'solid-js';
import { ArtifactFrame } from '../components/artifact-frame';
import { createArtifactFrame } from '../primitives/create-artifact-frame';
import {
  useArtifactViewUrlQuery,
  type ViewUrlTarget,
} from '../queries/artifact';
import { useArtifactPublishedSync } from '../queries/artifact-sync';

export type ArtifactFrameViewProps = ViewUrlTarget & { name: string };

/**
 * One artifact page in a sandboxed frame on the artifact's own origin. It
 * follows the current version unless pinned to one, and mounts anywhere: the
 * block, a canvas embed.
 */
export function ArtifactFrameView(props: ArtifactFrameViewProps) {
  return (
    <TraceFlow
      name="artifact.view"
      key={() => `${props.documentId}:${props.version}:${props.scene}`}
      attributes={{
        'document.id': props.documentId,
        'artifact.pinned': props.version !== undefined,
        'artifact.scene': props.scene !== undefined,
      }}
    >
      <ArtifactFrameContent {...props} />
    </TraceFlow>
  );
}

function ArtifactFrameContent(props: ArtifactFrameViewProps) {
  useArtifactPublishedSync(() => props.documentId);

  const viewUrl = useArtifactViewUrlQuery(
    () => ({
      documentId: props.documentId,
      version: props.version,
      scene: props.scene,
    }),
    liveThemeMode
  );
  usePending('artifact.view_url', () => viewUrl.isLoading);

  const url = () => (viewUrl.isSuccess ? viewUrl.data.url : undefined);
  const frame = createArtifactFrame({
    url,
    origin: () => (viewUrl.isSuccess ? viewUrl.data.origin : undefined),
    theme: liveThemeMode,
  });
  usePending('artifact.frame', () => viewUrl.isSuccess && !frame.loaded());

  const frameHeight = () => {
    const height = frame.height();
    return height === undefined ? '100%' : `max(100%, ${height}px)`;
  };

  return (
    <div class="relative size-full overflow-auto bg-surface">
      <Switch>
        <Match when={viewUrl.isError}>
          <div class="flex size-full flex-col items-center justify-center gap-3 p-4 text-sm text-ink-muted">
            <p>{t('artifacts.unavailable')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fireAndForget(viewUrl.refetch(), 'artifact-frame')}
            >
              {t('artifacts.retry')}
            </Button>
          </div>
        </Match>
        <Match when={url()}>
          {(src) => (
            <div class="w-full" style={{ height: frameHeight() }}>
              <ArtifactFrame
                url={src()}
                title={t('artifacts.frameTitle', { name: props.name })}
                loaded={frame.loaded()}
                ref={frame.setElement}
                onLoad={frame.onLoad}
              />
            </div>
          )}
        </Match>
      </Switch>
      <Show when={!viewUrl.isError && !frame.loaded()}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner label={t('artifacts.loading')} />
        </div>
      </Show>
    </div>
  );
}
