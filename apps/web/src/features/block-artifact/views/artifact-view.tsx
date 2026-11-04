import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { Show } from 'solid-js';
import { VersionBanner } from '../components/version-banner';
import { SceneSwitcher } from '../components/scene-switcher';
import { selectScene } from '../core/scenes';
import {
  useArtifactQuery,
  useArtifactVersionQuery,
  useRestoreArtifactVersionMutation,
} from '../queries/artifact';
import { ArtifactFrameView } from './artifact-frame-view';

export type ArtifactViewProps = {
  documentId: string;
  name: string;
  canEdit: boolean;
  /** The scene the URL asks for; ignored when the version doesn't have it. */
  requestedScene: string | undefined;
  onSelectScene: (sceneId: string | undefined) => void;
  /** An older version being looked at; undefined follows the current one. */
  viewedVersion: number | undefined;
  onViewLatest: () => void;
};

/** The artifact block's body: scene tabs, an older version's banner, the page. */
export function ArtifactView(props: ArtifactViewProps) {
  const artifact = useArtifactQuery(() => props.documentId);
  usePending('artifact.detail', () => artifact.isLoading);

  const current = () =>
    artifact.isSuccess ? artifact.data.current : undefined;
  const pinnedNumber = () => {
    const viewed = props.viewedVersion;
    return viewed === undefined || viewed === current()?.number
      ? undefined
      : viewed;
  };
  const pinned = useArtifactVersionQuery(() => props.documentId, pinnedNumber);
  const version = () => {
    if (pinnedNumber() === undefined) return current();
    return pinned.isSuccess ? pinned.data : undefined;
  };
  const scenes = () => version()?.scenes ?? [];
  const scene = () => selectScene(scenes(), props.requestedScene);
  // A requested scene waits for the manifest; the index needs nothing.
  const frameReady = () => !props.requestedScene || !!version();

  const restore = useRestoreArtifactVersionMutation(() => props.documentId);
  const restoreViewed = () => {
    const number = pinnedNumber();
    if (number === undefined) return;
    restore.mutate(number, {
      onSuccess: () => {
        toast.success(t('artifacts.restored', { number }));
        props.onViewLatest();
      },
      onError: () => toast.failure(t('artifacts.restoreFailed')),
    });
  };

  return (
    // Static pads on mobile and tablet: the frame scrolls internally, so the
    // floating chrome sits beside it rather than over it.
    <div class="flex size-full min-h-0 flex-col bg-surface touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <Show when={scenes().length > 0}>
        <div class="flex shrink-0 items-center px-3 py-1.5 touch:hidden">
          <SceneSwitcher
            scenes={scenes()}
            selected={scene()}
            onSelect={props.onSelectScene}
          />
        </div>
      </Show>
      <Show when={pinnedNumber()}>
        {(number) => (
          <VersionBanner
            number={number()}
            canRestore={props.canEdit}
            restoring={restore.isPending}
            onLatest={props.onViewLatest}
            onRestore={restoreViewed}
          />
        )}
      </Show>
      <div class="min-h-0 flex-1">
        <Show when={frameReady()}>
          <ArtifactFrameView
            documentId={props.documentId}
            name={props.name}
            version={pinnedNumber()}
            scene={scene()}
          />
        </Show>
      </div>
    </div>
  );
}
