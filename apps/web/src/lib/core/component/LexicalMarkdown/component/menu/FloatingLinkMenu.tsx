import { UnfurlLink } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import clickOutside from '@core/directive/clickOutside';
import { useUnfurl } from '@core/signal/unfurl';
import { openExternalUrl } from '@core/util/url';
import { mergeRegister } from '@lexical/utils';
import NewTab from '@phosphor/arrow-square-out.svg';
import Check from '@phosphor/check-circle.svg';
import Copy from '@phosphor/copy.svg';
import Link from '@phosphor/link.svg';
import Trash from '@phosphor/link-break.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import LinkText from '@phosphor/text-t.svg';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { Button, Surface } from '@ui';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
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
import {
  type AutoLinkMatchMode,
  type ILinkInfo,
  INSERT_LINK_COMMAND,
  linksPlugin,
  UNLINK_COMMAND,
  UPDATE_LINK_COMMAND,
  UPDATE_LINK_URL_COMMAND,
} from '../../plugins';
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
  const { plugins, editor } = useContext(LexicalWrapperContext) ?? {};
  if (!plugins || !editor) {
    console.error(
      'FloatingLinkMenu requires plugins and editor from LexicalWrapperContext!'
    );
    return '';
  }

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
    editor.dispatchCommand(UNLINK_COMMAND, undefined);
    reset();
    setTimeout(() => {
      editor.focus();
    });
  };

  const openInNewTab = () => {
    const url = pendingLinkInfo()?.url;
    if (!url) return;
    openExternalUrl(url);
  };

  const copyLink = () => {
    if (!pendingLinkInfo()) return;
    try {
      navigator.clipboard.writeText(pendingLinkInfo()!.url || '');
      toast.success('Copied link to clipboard');
    } catch {}
  };

  const handleEditClick = () => {
    setIsEditing(true);
    setTimeout(() => {
      if (urlInputRef) {
        urlInputRef.focus();
      }
    });
  };

  const handleSubmit = () => {
    const prev = linkInfo();
    const pending = pendingLinkInfo();
    if (!prev || !pending) {
      reset();
      editor.focus();
      return;
    }

    if (pending.url === undefined || pending.linkText === undefined) {
      reset();
      editor.focus();
      return;
    }

    // Insert new link.
    if (createMode()) {
      editor.dispatchCommand(INSERT_LINK_COMMAND, {
        url: pending.url,
        linkText: pending.linkText,
      });
      reset();
      editor.focus();
      return;
    }

    // No updates, no op.
    if (pending.url === prev.url && pending.linkText === prev.linkText) {
      reset();
      editor.focus();
      return;
    }

    // Only update url.
    if (pending.url !== prev.url && pending.linkText === prev.linkText) {
      editor.dispatchCommand(UPDATE_LINK_URL_COMMAND, pending.url);
      reset();
      editor.focus();
      return;
    }

    // Update the url and its child text.
    editor.dispatchCommand(UPDATE_LINK_COMMAND, {
      url: pending.url,
      linkText: pending.linkText,
    });
    reset();
    editor.focus();
  };

  plugins.use(
    linksPlugin({
      onHoverLink,
      onClickLink,
      onCreateLink,
      autoLinkMatchMode: props.autoLinkMatchMode,
    })
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
          editor.dispatchCommand(UNLINK_COMMAND, undefined);
        });
      }
      reset();
      editor.focus();
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
    mergeRegister(
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (menuOpen()) {
            setMenuOpen(false);
            editor.focus();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        () => {
          if (menuOpen()) {
            handleSubmit();
            reset();
            editor.focus();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    )
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
          reactiveOnContainer: editor.getRootElement(),
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
            <Surface depth={2} class="rounded-xl bg-menu p-1.5 shadow-menu">
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
                class="fixed top-0 left-0 z-modal-content w-80 max-w-[calc(100vw-1rem)]"
                use:floatWithElement={{
                  element: () => link().linkRef,
                  useBlockBoundary: true,
                }}
              >
                <Surface
                  depth={2}
                  class="rounded-xl p-1.5 shadow-lg shadow-drop-shadow"
                >
                  <Show
                    when={unfurledDetails()}
                    fallback={
                      <UnfurlLink
                        size="sm"
                        unfurled={{
                          url: link().url ?? '',
                          title: link().linkText ?? '',
                        }}
                      />
                    }
                  >
                    {(details) => <UnfurlLink size="sm" unfurled={details()} />}
                  </Show>
                </Surface>
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
                  variant="accent"
                  size="icon-sm"
                  tooltip="Open in new tab"
                >
                  <NewTab />
                </Button>
                <Button
                  onClick={handleEditClick}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Edit link"
                >
                  <Pencil />
                </Button>
                <Button
                  onClick={copyLink}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Copy link"
                >
                  <Copy />
                </Button>
                <Button
                  onClick={handleUnlink}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Remove link"
                >
                  <Trash />
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
              variant="cta"
              size="sm"
              tooltip="Apply link changes"
              disabled={!pendingLinkInfo()?.url && !pendingLinkInfo()?.linkText}
            >
              <Check /> Apply
            </Button>
          </div>
        </MenuWrapper>
      </Match>
    </Switch>
  );
}
