import CopyIcon from '@phosphor/copy.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import ShareIcon from '@phosphor/share.svg';
import SidebarIcon from '@phosphor/sidebar.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import TrashIcon from '@phosphor/trash.svg';
import SparkleFillIcon from '@phosphor-fill/sparkle-fill.svg';
import { Show } from 'solid-js';
import { MenuAnchor } from './Menu';

/** What the toolbar can do to the open session. */
export type SessionActions = {
  favorite: boolean;
  onToggleFavorite: () => void;
  onShare: () => void;
  onSidePanel: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
};

/**
 * The main pane's title row. Session-only controls stay in the markup and the
 * stylesheet hides them until the root carries `data-session`.
 */
export function Topbar(props: { title: string; session?: SessionActions }) {
  return (
    <div class="topbar">
      <h1 class="truncate">{props.title}</h1>
      <div class="right">
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
          <span class="sep session-only" />
          <MenuAnchor
            class="session-only"
            menuLabel="Session actions"
            menuClass="below"
            role="menu"
            style={{ width: '220px' }}
            trigger={(menu) => (
              <button
                type="button"
                class="icon-btn"
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={menu.open()}
                onClick={(event) => {
                  event.stopPropagation();
                  menu.toggle();
                }}
              >
                <DotsIcon class="ph" />
              </button>
            )}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  class="opt"
                  role="menuitem"
                  onClick={() => {
                    close();
                    props.session?.onRename();
                  }}
                >
                  <PencilIcon class="ph" />
                  <span class="nm">Rename</span>
                </button>
                <button
                  type="button"
                  class="opt"
                  role="menuitem"
                  onClick={() => {
                    close();
                    props.session?.onCopyLink();
                  }}
                >
                  <CopyIcon class="ph" />
                  <span class="nm">Copy link</span>
                </button>
                <button
                  type="button"
                  class="opt"
                  role="menuitem"
                  onClick={() => {
                    close();
                    props.session?.onToggleFavorite();
                  }}
                >
                  <SparkleIcon class="ph" />
                  <span class="nm">
                    {props.session?.favorite
                      ? 'Remove from favorites'
                      : 'Add to favorites'}
                  </span>
                </button>
                <div class="grp" style={{ padding: '4px 0 0' }} />
                <button
                  type="button"
                  class="opt"
                  role="menuitem"
                  style={{ color: 'var(--red)' }}
                  onClick={() => {
                    close();
                    props.session?.onDelete();
                  }}
                >
                  <TrashIcon class="ph" />
                  <span class="nm">Delete session</span>
                </button>
              </>
            )}
          </MenuAnchor>
        </div>
      </div>
    </div>
  );
}
