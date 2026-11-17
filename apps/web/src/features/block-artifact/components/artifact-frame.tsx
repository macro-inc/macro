/**
 * Agent-written pages run on the artifact's own origin, never Macro's. No
 * top navigation, forms, modals, or downloads; popups so links open tabs.
 */
const FRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export function ArtifactFrame(props: {
  url: string;
  title: string;
  loaded: boolean;
  ref: (element: HTMLIFrameElement) => void;
  onLoad: () => void;
}) {
  return (
    <iframe
      ref={props.ref}
      title={props.title}
      src={props.url}
      sandbox={FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      data-artifact-frame
      class="size-full border-0 bg-surface transition-opacity duration-150"
      classList={{ 'opacity-0': !props.loaded }}
      onLoad={props.onLoad}
    />
  );
}
