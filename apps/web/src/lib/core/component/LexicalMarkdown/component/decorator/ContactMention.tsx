import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useNativeSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import BuildingIcon from '@icon/system/regular/buildings.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { ContactMentionDecoratorProps } from '@macro-inc/lexical-core';
import { cn } from '@ui';
import { COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND } from 'lexical';
import { createSignal, Show, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

false && floatWithElement;

export function ContactMention(props: ContactMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const { openWithSplit } = useSplitLayout()!;

  const [popupOpen, setPopupOpen] = createSignal(false);
  let mentionRef!: HTMLSpanElement;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const openContact = (e: MouseEvent | KeyboardEvent | null) => {
    // The contactId is the email or @domain
    const contactId = encodeURIComponent(props.emailOrDomain);
    const inNewSplit = openInNewSplitForMention(e?.shiftKey, e != null);
    openWithSplit(
      { type: 'contact', id: contactId },
      { preferNewSplit: inNewSplit }
    );
  };

  const displayName = () => {
    // For companies, show @domain
    if (props.isCompany) {
      return props.emailOrDomain;
    }

    // For persons, format the name properly
    let name = props.name.trim();

    // Check if name is in "LastName, FirstName [MiddleInitial]" format
    if (name.includes(',')) {
      const parts = name.split(',').map((p) => p.trim());
      if (parts.length === 2) {
        const lastName = parts[0];
        const firstAndMiddle = parts[1];

        // Parse first name and middle initial
        const nameParts = firstAndMiddle.split(/\s+/);
        const firstName = nameParts[0];

        // Handle middle initials (with or without periods)
        const middleInitials = nameParts
          .slice(1)
          .filter((p) => p.length <= 2 || (p.length === 3 && p.endsWith('.')))
          .map((p) => p.replace('.', ''))
          .join(' ');

        // Format as "FirstName [MiddleInitial] LastName"
        name = middleInitials
          ? `${firstName} ${middleInitials} ${lastName}`
          : `${firstName} ${lastName}`;
      }
    }

    // Capitalize each word properly
    return name
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          if (isSelectedAsNode()) {
            openContact(e);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  const navHandlers = useNativeSplitNavigationHandler(openContact);

  return (
    <>
      <span
        ref={mentionRef}
        class={cn(
          'relative p-0.5 cursor-default rounded-md bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent',
          isSelectedAsNode() && 'bg-active'
        )}
        {...navHandlers}
        onMouseEnter={() => setPopupOpen(true)}
        onMouseLeave={() => setPopupOpen(false)}
      >
        <span
          data-contact-id={props.contactId}
          data-email-or-domain={props.emailOrDomain}
          data-is-company={props.isCompany}
          data-contact-mention="true"
        >
          {/* The face is one unbreakable box, so a long address can't wrap:
              it truncates at the line's width (less the chip's padding)
              instead of widening the message. The hover card shows it whole. */}
          <span class="inline-flex max-w-[calc(100%-0.25rem)] items-center gap-1">
            <Show
              when={props.isCompany}
              fallback={<UserIcon class="size-3 shrink-0" />}
            >
              <BuildingIcon class="size-3 shrink-0" />
            </Show>
            <span class="min-w-0 truncate">{displayName()}</span>
          </span>
        </span>
        <MentionTooltip show={isSelectedAsNode()} text="Open" />
      </span>

      <Show when={popupOpen()}>
        <Portal>
          <div
            class="absolute select-none overflow-hidden z-toast-region w-64 border border-edge bg-surface text-ink rounded-lg p-3"
            use:floatWithElement={{ element: () => mentionRef }}
          >
            <div class="flex items-center gap-2">
              <Show
                when={props.isCompany}
                fallback={<UserIcon class="size-5 shrink-0" />}
              >
                <BuildingIcon class="size-5 shrink-0" />
              </Show>
              <div class="min-w-0 flex-1">
                <div class="font-semibold wrap-anywhere">{props.name}</div>
                <div class="text-sm text-ink-muted wrap-anywhere">
                  {props.emailOrDomain}
                </div>
              </div>
            </div>
            <div class="mt-2 text-xs text-ink-muted">
              Click to view {props.isCompany ? 'company' : 'contact'} details
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
