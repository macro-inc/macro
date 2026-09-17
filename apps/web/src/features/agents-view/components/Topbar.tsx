import { ViewShell } from '@app/components/view-shell/ViewShell';
import ShareIcon from '@phosphor/share.svg';
import SidebarIcon from '@phosphor/sidebar.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import SparkleFillIcon from '@phosphor-fill/sparkle-fill.svg';
import { type JSX, Show } from 'solid-js';

/** What the toolbar can do to the open session. */
export type SessionActions = {
  favorite: boolean;
  onToggleFavorite: () => void;
  onShare: () => void;
  onSidePanel: () => void;
};

/**
 * The main pane's title row. Session-only controls stay in the markup and the
 * stylesheet hides them until the root carries `data-session`.
 */
export function Topbar(props: {
  title: string;
  titleContent?: JSX.Element;
  session?: SessionActions;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar class="touch:flex">
      <div class="flex min-w-0 flex-1 items-center">
        {props.titleContent ?? (
          <h1 class="min-w-0 truncate text-sm font-semibold text-ink">
            {props.title}
          </h1>
        )}
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {props.children}
        <div class="bbar" role="toolbar" aria-label="Session actions">
          <button
            type="button"
            class="icon-btn session-only"
            aria-label={
              props.session?.favorite ? 'Remove from favorites' : 'Favorite'
            }
            title="Favorite"
            aria-pressed={props.session?.favorite}
            disabled={!props.session}
            onClick={() => props.session?.onToggleFavorite()}
          >
            <Show
              when={props.session?.favorite}
              fallback={<SparkleIcon class="ph" />}
            >
              <SparkleFillIcon class="ph" style={{ color: 'var(--accent)' }} />
            </Show>
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Share"
            title="Share"
            disabled={!props.session}
            onClick={() => props.session?.onShare()}
          >
            <ShareIcon class="ph" />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Side panel"
            title="Side panel (])"
            disabled={!props.session}
            onClick={() => props.session?.onSidePanel()}
          >
            <SidebarIcon class="ph" />
          </button>
        </div>
      </div>
    </ViewShell.TopBar>
  );
}
