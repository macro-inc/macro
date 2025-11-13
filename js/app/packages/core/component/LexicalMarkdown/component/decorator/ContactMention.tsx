import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import BuildingIcon from '@icon/regular/buildings.svg';
import UserIcon from '@icon/regular/user.svg';
import type { ContactMentionDecoratorProps } from '@lexical-core';
import { COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND } from 'lexical';
import { createSignal, Show, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useSplitLayout } from '../../../../../app/component/split-layout/layout';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

false && floatWithElement;

export function ContactMention(props: ContactMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const { replaceOrInsertSplit, insertSplit } = useSplitLayout()!;

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
    if (e?.altKey) {
      insertSplit({
        type: 'contact',
        id: contactId,
      });
    } else {
      replaceOrInsertSplit({
        type: 'contact',
        id: contactId,
      });
    }
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

  const navHandlers = useSplitNavigationHandler(openContact);

  return (
    <>
      <span
        ref={mentionRef}
        class={`relative py-0.5 px-0.5 cursor-default rounded-xs bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent-ink`}
        classList={{
          'bracket-offset-2': isSelectedAsNode(),
        }}
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
          <span class="inline-flex items-center gap-1">
            <Show
              when={props.isCompany}
              fallback={<UserIcon class="w-3 h-3" />}
            >
              <BuildingIcon class="w-3 h-3" />
            </Show>
            {displayName()}
          </span>
        </span>
        <MentionTooltip show={isSelectedAsNode()} text="Open" />
      </span>

      <Show when={popupOpen()}>
        <Portal>
          <div
            class="absolute select-none overflow-hidden z-toast-region w-64 bg-dialog ring-1 ring-edge text-ink rounded-lg p-3"
            use:floatWithElement={{ element: () => mentionRef }}
          >
            <div class="flex items-center gap-2">
              <Show
                when={props.isCompany}
                fallback={<UserIcon class="w-5 h-5" />}
              >
                <BuildingIcon class="w-5 h-5" />
              </Show>
              <div class="flex-1">
                <div class="font-semibold">{props.name}</div>
                <div class="text-sm text-ink-muted">{props.emailOrDomain}</div>
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
