/**
 * Artifacts on a canvas: the canvas's `document` node with `fileType:
 * 'artifact'` and the scene id as its `subpath`. The canvas loads these
 * lazily, so none of this joins its chunk.
 */
import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { createEffect, For, Show } from 'solid-js';
import { SceneDropdown } from '../components/scene-switcher';
import { selectScene } from '../core/scenes';
import { useArtifactQuery } from '../queries/artifact';
import { ArtifactFrameView } from './artifact-frame-view';

/** The embed body; follows the current version, as every viewer's does. */
export function ArtifactCanvasEmbed(props: {
  documentId: string;
  name: string;
  scene: string | undefined;
}) {
  const artifact = useArtifactQuery(() => props.documentId);
  const scene = () =>
    artifact.isSuccess
      ? selectScene(artifact.data.current.scenes, props.scene)
      : undefined;
  // A scene waits for the manifest: a later version may have dropped it.
  const ready = () => !props.scene || artifact.isSuccess;
  return (
    <Show when={ready()}>
      <ArtifactFrameView
        documentId={props.documentId}
        name={props.name}
        scene={scene()}
      />
    </Show>
  );
}

/** The scene's title under a preview card. */
export function ArtifactSceneLabel(props: {
  documentId: string;
  scene: string;
}) {
  const artifact = useArtifactQuery(() => props.documentId);
  const title = () =>
    artifact.isSuccess
      ? artifact.data.current.scenes.find((scene) => scene.id === props.scene)
          ?.title
      : undefined;
  return (
    <Show when={title()}>
      {(text) => (
        <p class="truncate px-3 pb-2 text-sm text-ink-muted">{text()}</p>
      )}
    </Show>
  );
}

/** Choose which scene a node shows; the overview is the artifact's index. */
export function ArtifactSceneSelect(props: {
  documentId: string;
  value: string | undefined;
  onChange: (scene: string | undefined) => void;
}) {
  const artifact = useArtifactQuery(() => props.documentId);
  const scenes = () => (artifact.isSuccess ? artifact.data.current.scenes : []);
  return (
    <Show when={scenes().length > 0}>
      <SceneDropdown
        class="mx-3 mb-3"
        scenes={scenes()}
        selected={selectScene(scenes(), props.value)}
        onSelect={props.onChange}
      />
    </Show>
  );
}

/**
 * The insert flow's last step for an artifact with scenes. One without scenes
 * is placed whole right away.
 */
export function ArtifactScenePicker(props: {
  documentId: string;
  onPick: (scene: string | undefined) => void;
}) {
  const artifact = useArtifactQuery(() => props.documentId);
  const scenes = () => (artifact.isSuccess ? artifact.data.current.scenes : []);
  let picked = false;
  const pick = (scene: string | undefined) => {
    if (picked) return;
    picked = true;
    props.onPick(scene);
  };
  // Nothing to choose, or the manifest can't be read: place it whole.
  createEffect(() => {
    if (artifact.isError || (artifact.isSuccess && scenes().length === 0))
      pick(undefined);
  });
  return (
    <Show
      when={scenes().length > 0}
      fallback={
        <p role="status" class="p-3 text-ink-muted">
          {t('artifacts.loading')}
        </p>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        <p class="px-2 pb-1 text-xs text-ink-muted">{t('artifacts.scenes')}</p>
        <Button
          variant="ghost"
          size="sm"
          class="justify-start"
          onClick={() => pick(undefined)}
        >
          {t('artifacts.overview')}
        </Button>
        <For each={scenes()}>
          {(scene) => (
            <Button
              variant="ghost"
              size="sm"
              class="justify-start"
              onClick={() => pick(scene.id)}
            >
              <span class="truncate">{scene.title}</span>
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
