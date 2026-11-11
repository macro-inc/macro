import { LinkHoverCard } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import clickOutside from '@core/directive/clickOutside';
import { useUnfurl } from '@core/signal/unfurl';
import { openExternalUrl } from '@core/util/url';
import NewTab from '@icon/system/regular/arrow-square-out.svg';
import Check from '@icon/system/regular/check-circle.svg';
import Copy from '@icon/system/regular/copy.svg';
import Link from '@icon/system/regular/link.svg';
import Trash from '@icon/system/regular/link-break.svg';
import Pencil from '@icon/system/regular/pencil-simple.svg';
import LinkText from '@icon/system/regular/text-t.svg';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { Button, Surface } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { floatWithSelection } from '../../directive/floatWithSelection';
import { createLexicalLinkMenuHost } from '../../editing/overlay-hosts/lexical-link';
import type { LinkMenuHost } from '../../editing/overlay-hosts/link';
import type {
  AutoLinkMatchMode,
  ILinkInfo,
} from '../../plugins/links/linksPlugin';
import { autoRegister } from '../../plugins/shared/utils';

false && floatWithElement;
false && floatWithSelection;
false && clickOutside;

const MENU_ID = 'floating-link-menu';
const HOVER_ID = 'floating-link-hover';

export function FloatingLinkMenu(props: {
  closePopup?: () => void;
  autoLinkMatchMode?: AutoLinkMatchMode;
}) {
  const wrapper = useContext(LexicalWrapperContext);
  if (!wrapper?.plugins || !wrapper.editor) {
    console.error(
      'FloatingLinkMenu requires plugins and editor from LexicalWrapperContext!'
    );
    return '';
  }

  return (
    <HostedFloatingLinkMenu
      host={createLexicalLinkMenuHost(wrapper)}
      closePopup={props.closePopup}
      autoLinkMatchMode={props.autoLinkMatchMode}
    />
  );
}

/** Shared link controller and markup; the mounting surface supplies its model. */
export function HostedFloatingLinkMenu(props: {
  host: LinkMenuHost;
  closePopup?: () => void;
  autoLinkMatchMode?: AutoLinkMatchMode;
}) {
  const host = props.host;

  // The link info at the time the menu was triggered.
  const [linkInfo, setLinkInfo] = createSignal<ILinkInfo>();

  // The link info that is being edited.
  const [pendingLinkInfo, setPendingLinkInfo] = createSignal<ILinkInfo>();

  // Whether to use the simplified hover preview.
  const [previewHover, setPreviewHover] = createMenuOpenSignal(
    HOVER_ID,
    MenuPriority.Low
  );

  // Whether the menu is open visible.
  const [menuOpen, setMenuOpen] = createMenuOpenSignal(
    MENU_ID,
    MenuPriority.High
  );

  // Switch on the read vs edit version of the menu.
  const [isEditing, setIsEditing] = createSignal(false);

  // Switch on submit behavior
  const [createMode, setCreateMode] = createSignal(false);

  let urlInputRef!: HTMLInputElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const reset = () => {
    setLinkInfo();
    setPendingLinkInfo();
    setIsEditing(false);
    setMenuOpen(false);
    setPreviewHover(false);
    setCreateMode(false);
  };

  createEffect(
    on(
      () => host.isInteractable(),
      (interactable) => {
        if (interactable === false) reset();
      }
    )
  );

  // Passed to link plugin in to be called when the mouse hovers over a link.
  const onHoverLink = (link?: ILinkInfo) => {
    // We are editing a link so ignore hover.
    if (menuOpen()) {
      setPreviewHover(false);
      return;
    }

    if (!link) {
      reset();
      return;
    }

    setLinkInfo({ ...link });

    setTimeout(() => setPreviewHover(true));
  };

  // Passed to link plugin in to be called when the a link is clicked.
  const onClickLink = (link?: ILinkInfo) => {
    if (link === undefined) {
      reset();
      return;
    }
    if (!link.editAccess) return;
    setMenuOpen(true);
    setPreviewHover(false);
    setLinkInfo({ ...link });
    setPendingLinkInfo({ ...link });
    if (link.autoFocus) {
      setTimeout(() => {
        urlInputRef?.focus();
      });
    }
  };

  // Passed to link plugin in to be called when the user clicks the "create link" button.
  const onCreateLink = (link?: ILinkInfo) => {
    if (link === undefined) {
      reset();
      return;
    }
    setMenuOpen(true);
    setLinkInfo({ ...link });
    setPendingLinkInfo({ ...link });
    setCreateMode(true);
    if (link.autoFocus) {
      setTimeout(() => {
        urlInputRef?.focus();
      });
    }
  };

  const handleUnlink = () => {
    if (!host.isEditable()) return;
    host.unlink();
    reset();
    setTimeout(() => {
      host.focus();
    });
  };

  const openInNewTab = () => {
    const url = pendingLinkInfo()?.url;
    if (!url) return;
    openExternalUrl(url);
  };

  const copyLink = async () => {
    if (!pendingLinkInfo()) return;
    try {
      await navigator.clipboard.writeText(pendingLinkInfo()!.url || '');
    } catch {
      toast.failure('Could not copy link');
      return;
    }
    toast.success('Copied link to clipboard');
  };

  const handleEditClick = () => {
    if (!host.isEditable()) return;
    setIsEditing(true);
    setTimeout(() => {
      if (urlInputRef) {
        urlInputRef.focus();
      }
    });
  };

  const handleSubmit = () => {
    if (!host.isEditable()) return;
    const prev = linkInfo();
    const pending = pendingLinkInfo();
    if (!prev || !pending) {
      reset();
      host.focus();
      return;
    }

    if (pending.url === undefined || pending.linkText === undefined) {
      reset();
      host.focus();
      return;
    }

    // Insert new link.
    if (createMode()) {
      host.insert(pending.url, pending.linkText);
      reset();
      host.focus();
      return;
    }

    // No updates, no op.
    if (pending.url === prev.url && pending.linkText === prev.linkText) {
      reset();
      host.focus();
      return;
    }

    // Only update url.
    if (pending.url !== prev.url && pending.linkText === prev.linkText) {
      host.updateUrl(pending.url);
      reset();
      host.focus();
      return;
    }

    // Update the url and its child text.
    host.update(pending.url, pending.linkText);
    reset();
    host.focus();
  };

  host.registerMenu(
    { hover: onHoverLink, click: onClickLink, create: onCreateLink },
    props.autoLinkMatchMode
  );

  const keydown = (e: KeyboardEvent) => {
    if (!menuOpen()) {
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (
        linkInfo()?.url === undefined &&
        pendingLinkInfo()?.url === undefined
      ) {
        setTimeout(() => {
          if (host.isEditable()) host.unlink();
        });
      }
      reset();
      host.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', keydown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', keydown);
  });

  autoRegister(
    host.registerKeys({
      escape() {
        if (menuOpen()) {
          setMenuOpen(false);
          host.focus();
          return true;
        }
        return false;
      },
      enter() {
        if (menuOpen()) {
          handleSubmit();
          reset();
          host.focus();
          return true;
        }
        return false;
      },
    })
  );

  const expanded = () => menuOpen() && (isEditing() || createMode());

  createEffect(() => {
    if (menuOpen()) {
      if (props.closePopup) {
        props.closePopup();
      }
    }
  });

  const unfurledDetails = createMemo(() => {
    const url = linkInfo()?.url;
    if (!url) return null;
    const data = useUnfurl(url)[0]();
    if (!data || data.type !== 'success') {
      return {
        url,
        title: linkInfo()?.linkText ?? url,
      } as GetUnfurlResponse;
    }
    return data.data;
  });

  const floatWithElementProps = () =>
    linkInfo()?.linkRef
      ? {
          element: () => linkInfo()?.linkRef,
          useBlockBoundary: true,
        }
      : undefined;

  const floatWithSelectionProps = () =>
    !linkInfo()?.linkRef && linkInfo()?.selection
      ? {
          selection: linkInfo()?.selection,
          reactiveOnContainer: host.root(),
          useBlockBoundary: true,
        }
      : undefined;

  const MenuWrapper = (props: ParentProps) => {
    return (
      <Show when={linkInfo()?.linkRef || linkInfo()?.selection}>
        <ScopedPortal scope="block">
          <div
            class="fixed top-0 left-0 z-modal-content w-80 max-w-[calc(100vw-1rem)] text-sm menu-open-animation"
            use:floatWithElement={floatWithElementProps()}
            use:floatWithSelection={floatWithSelectionProps()}
            use:clickOutside={() => {
              setMenuOpen(false);
              setIsEditing(false);
            }}
            ref={menuRef}
          >
            <Surface depth={2} hideBorder class="menu-surface p-1.5">
              {props.children}
            </Surface>
          </div>
        </ScopedPortal>
      </Show>
    );
  };

  return (
    <Switch>
      <Match when={previewHover()}>
        <Show when={linkInfo()}>
          {(link) => (
            <ScopedPortal>
              <div
                class="fixed top-0 left-0 z-modal-content"
                use:floatWithElement={{
                  element: () => link().linkRef,
                  useBlockBoundary: true,
                }}
              >
                <Show
                  when={unfurledDetails()}
                  fallback={
                    <LinkHoverCard
                      unfurled={{
                        url: link().url ?? '',
                        title: link().linkText ?? '',
                      }}
                    />
                  }
                >
                  {(details) => <LinkHoverCard unfurled={details()} />}
                </Show>
              </div>
            </ScopedPortal>
          )}
        </Show>
      </Match>
      <Match when={menuOpen()}>
        <MenuWrapper>
          <div class="flex items-center gap-1.5">
            <div class="flex h-8 min-w-0 grow items-center gap-2 rounded-md border border-edge-muted bg-surface px-2 focus-within:border-accent">
              <Link class="size-4 shrink-0 text-ink-extra-muted" />
              <input
                ref={urlInputRef}
                tabIndex={2}
                type="text"
                value={pendingLinkInfo()?.url ?? ''}
                onInput={(e) => {
                  if (!pendingLinkInfo()) return;
                  setPendingLinkInfo({
                    ...pendingLinkInfo()!,
                    url: e.currentTarget.value,
                  });
                }}
                onFocus={() => setIsEditing(true)}
                placeholder="https://example.com"
                class="min-w-0 grow bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
              />
            </div>
            <div
              class="relative flex shrink-0 items-center justify-end"
              classList={{ hidden: expanded() }}
            >
              <div class="flex items-center gap-0.5 ease-in-out">
                <Button
                  onClick={openInNewTab}
                  variant="primary"
                  size="icon-sm"
                  tooltip="Open in new tab"
                >
                  <NewTab class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
                </Button>
                <Button
                  onClick={handleEditClick}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Edit link"
                >
                  <Pencil class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
                </Button>
                <Button
                  onClick={copyLink}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Copy link"
                >
                  <Copy class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
                </Button>
                <Button
                  onClick={handleUnlink}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Remove link"
                >
                  <Trash class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
                </Button>
              </div>
            </div>
          </div>
          <div
            class="flex overflow-hidden ease-in-out"
            classList={{
              'max-h-0 mt-0': !expanded(),
              'max-h-24 mt-1.5': expanded(),
            }}
          >
            <div class="flex h-8 min-w-0 grow items-center gap-2 rounded-md border border-edge-muted bg-surface px-2 focus-within:border-accent">
              <LinkText class="size-4 shrink-0 text-ink-extra-muted" />
              <input
                tabIndex={3}
                type="text"
                value={pendingLinkInfo()?.linkText ?? ''}
                onInput={(e) => {
                  if (!pendingLinkInfo()) return;
                  setPendingLinkInfo({
                    ...pendingLinkInfo()!,
                    linkText: e.currentTarget.value,
                  });
                }}
                onFocus={() => setIsEditing(true)}
                placeholder="Link text"
                class="min-w-0 grow bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
              />
            </div>
          </div>
          <div
            class="flex justify-end overflow-hidden ease-in-out"
            classList={{
              'max-h-0 mt-0': !expanded(),
              'max-h-24 mt-1.5': expanded(),
            }}
          >
            <Button
              onClick={handleSubmit}
              variant="primary"
              size="sm"
              tooltip="Apply link changes"
              disabled={!pendingLinkInfo()?.url && !pendingLinkInfo()?.linkText}
            >
              <Check class="size-3 touch:size-6 shrink-0 pointer-events-none" />{' '}
              Apply
            </Button>
          </div>
        </MenuWrapper>
      </Match>
    </Switch>
  );
}
