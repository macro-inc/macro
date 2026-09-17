import { ViewShell } from '@app/components/view-shell/ViewShell';
import CopyIcon from '@phosphor/copy.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import ShareIcon from '@phosphor/share.svg';
import SidebarIcon from '@phosphor/sidebar.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import TrashIcon from '@phosphor/trash.svg';
import SparkleFillIcon from '@phosphor-fill/sparkle-fill.svg';
import { Dropdown } from '@ui';
import { type JSX, Show } from 'solid-js';

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
export function Topbar(props: {
  title: string;
  session?: SessionActions;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar class="touch:flex">
      <h1 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
        {props.title}
      </h1>
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
          <span class="sep session-only" />
          <Show when={props.session}>
            {(session) => (
              <Dropdown placement="bottom-end" gutter={8}>
                <Dropdown.Trigger
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Session menu"
                >
                  <DotsIcon class="size-5" />
                </Dropdown.Trigger>
                <Dropdown.Content class="w-56 max-w-[calc(100vw-1rem)]">
                  <Dropdown.Group>
                    <Dropdown.Item closeOnSelect onSelect={session().onRename}>
                      <PencilIcon class="size-4" />
                      Rename
                    </Dropdown.Item>
                    <Dropdown.Item
                      closeOnSelect
                      onSelect={session().onCopyLink}
                    >
                      <CopyIcon class="size-4" />
                      Copy link
                    </Dropdown.Item>
                    <Dropdown.Item
                      closeOnSelect
                      onSelect={session().onToggleFavorite}
                    >
                      <SparkleIcon class="size-4" />
                      {session().favorite
                        ? 'Remove from favorites'
                        : 'Add to favorites'}
                    </Dropdown.Item>
                  </Dropdown.Group>
                  <Dropdown.Group>
                    <Dropdown.Item
                      closeOnSelect
                      class="text-failure"
                      onSelect={session().onDelete}
                    >
                      <TrashIcon class="size-4" />
                      Delete session
                    </Dropdown.Item>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            )}
          </Show>
        </div>
      </div>
    </ViewShell.TopBar>
  );
}
