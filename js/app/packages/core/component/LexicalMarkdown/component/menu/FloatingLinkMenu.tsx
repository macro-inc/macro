import { UnfurlLink } from '@core/component/Link';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import clickOutside from '@core/directive/clickOutside';
import { useUnfurl } from '@core/signal/unfurl';
import { mergeRegister } from '@lexical/utils';
import NewTab from '@phosphor/arrow-square-out.svg';
import Check from '@phosphor/check-circle.svg';
import Copy from '@phosphor/copy.svg';
import Link from '@phosphor/link.svg';
import Trash from '@phosphor/link-break.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import LinkText from '@phosphor/text-t.svg';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { Button, Tooltip } from '@ui';
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

export function FloatingLinkMenu(props: { closePopup?: () => void }) {
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

  let [activeInput, setActiveInput] = createSignal<HTMLInputElement>();

  let urlInputRef!: HTMLInputElement | undefined;
  let linkTextInputRef: HTMLInputElement | undefined;
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
    if (!pendingLinkInfo()) return;
    window.open(pendingLinkInfo()!.url, '_blank');
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
            class="p-2 fixed bg-surface top-0 left-0 text-sm z-modal-content ring ring-edge-muted rounded-sm shadow-lg min-w-80"
            use:floatWithElement={floatWithElementProps()}
            use:floatWithSelection={floatWithSelectionProps()}
            use:clickOutside={() => {
              setMenuOpen(false);
              setIsEditing(false);
            }}
            ref={menuRef}
          >
            {props.children}
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
                class="p-2 absolute top-0 left-0 z-10 bg-surface w-80 shadow-lg ring-edge-muted rounded-sm ring-1"
                use:floatWithElement={{
                  element: () => link().linkRef,
                  useBlockBoundary: true,
                }}
              >
                <Show
                  when={unfurledDetails()}
                  fallback={
                    <UnfurlLink
                      unfurled={{
                        url: link().url ?? '',
                        title: link().linkText ?? '',
                      }}
                    />
                  }
                >
                  {(details) => <UnfurlLink unfurled={details()} />}
                </Show>
              </div>
            </ScopedPortal>
          )}
        </Show>
      </Match>
      <Match when={menuOpen()}>
        <MenuWrapper>
          <div class="flex items-center">
            <div
              class="flex items-center rounded grow gap-1 p-1 pr-2"
              classList={{
                'bg-active': activeInput() === urlInputRef,
              }}
            >
              <Link class="text-ink-extra-muted size-4" />
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
                onFocus={() => {
                  setActiveInput(urlInputRef);
                  setIsEditing(true);
                }}
                onBlur={() => {
                  // setActiveInput();
                }}
                placeholder="https://example.com"
                class="grow text-ellipsis ease-in-out placeholder-gray-400"
              />
            </div>
            <div class="relative flex items-center justify-end shrink">
              <div class="flex ease-in-out" classList={{ hidden: expanded() }}>
                <Button
                  onClick={openInNewTab}
                  class="p-1 hover:bg-hover hover-transition-bg"
                  variant="active"
                  size="icon-sm"
                  tooltip="Open in new tab"
                >
                  <NewTab />
                </Button>
                <Button
                  onClick={handleEditClick}
                  class="p-1 hover:bg-hover hover-transition-bg"
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Edit link"
                >
                  <Pencil />
                </Button>
                <Button
                  onClick={copyLink}
                  class="p-1 hover:bg-hover hover-transition-bg"
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Copy link"
                >
                  <Copy />
                </Button>
                <Button
                  onClick={handleUnlink}
                  class="p-1 hover:bg-hover hover-transition-bg"
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
            class="flex gap-1 ease-in-out overflow-hidden"
            classList={{
              'max-h-0 mt-0': !expanded(),
              'max-h-24 mt-1': expanded(),
            }}
          >
            <div
              class="flex items-center gap-1 rounded grow p-1 pr-2"
              classList={{
                'bg-active': activeInput() === linkTextInputRef,
              }}
            >
              <LinkText class="text-ink-extra-muted size-4" />
              <input
                tabIndex={3}
                type="text"
                ref={linkTextInputRef}
                value={pendingLinkInfo()?.linkText ?? ''}
                onInput={(e) => {
                  if (!pendingLinkInfo()) return;
                  setPendingLinkInfo({
                    ...pendingLinkInfo()!,
                    linkText: e.currentTarget.value,
                  });
                }}
                onFocus={() => {
                  setActiveInput(linkTextInputRef);
                  setIsEditing(true);
                }}
                onBlur={() => {
                  setActiveInput();
                }}
                placeholder="Link text"
                class="grow text-ellipsis ease-in-out placeholder-gray-400"
              />
            </div>
          </div>
          <div
            class="flex gap-1 ease-in-out overflow-hidden justify-end"
            classList={{
              'max-h-0 mt-0': !expanded(),
              'max-h-24 mt-1': expanded(),
            }}
          >
            <Tooltip label="Apply link changes">
              <Button
                onClick={handleSubmit}
                class="focus:ring-failure focus:ring-2 focus:ring-offset-2"
                variant="base"
                disabled={
                  !pendingLinkInfo()?.url && !pendingLinkInfo()?.linkText
                }
              >
                <Check /> Apply
              </Button>
            </Tooltip>
          </div>
        </MenuWrapper>
      </Match>
    </Switch>
  );
}
