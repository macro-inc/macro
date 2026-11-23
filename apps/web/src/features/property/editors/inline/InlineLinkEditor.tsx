import { t } from '@app/lib/i18n';
import { useUnfurl } from '@core/signal/unfurl';
import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import LinkIcon from '@icon/system/regular/link.svg';
import DeleteIcon from '@icon/system/regular/x.svg';
import { proxyResource } from '@service-unfurl/client';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useProperty } from '../../core/context';
import { PropertyEmpty } from '../../extractors/PropertyEmpty';
import {
  extractDomain,
  getLinkValues,
  hasValue,
  isLinkProperty,
} from '../../utils';

const ADD_BUTTON_CLASS =
  'text-ink-muted hover:text-ink hover:bg-hover px-2 py-0.5 inline-block shrink-0 rounded-sm cursor-default';

// Inline URL collection editor for LINK properties. Supports multi-select
// (chip list with add button) and single (one slot). Unfurl preview pulls
// favicon + title; remove on hover.
export function InlineLinkEditor(props: { emptyValue?: JSX.Element }) {
  const ctx = useProperty();

  const [isAdding, setIsAdding] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [badLinks, setBadLinks] = createStore<Record<string, true>>({});
  let addButton: HTMLButtonElement | undefined;

  const property = () => ctx.property();
  const isReadOnly = () => property().isMetadata || !ctx.canEdit();
  const links = () =>
    isLinkProperty(property()) ? getLinkValues(property()) : [];

  const startAdding = () => {
    if (isReadOnly()) return;
    setIsAdding(true);
    setInputValue('');
    setError(null);
  };

  const cancelAdding = () => {
    setIsAdding(false);
    setInputValue('');
    setError(null);
  };

  const normalize = (v: string) => {
    const t = v.trim();
    if (!t) return '';
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };

  const isValidUrl = (v: string) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  };

  const handleAddLink = async () => {
    if (isSaving()) return;
    const raw = inputValue().trim();
    if (!raw) {
      cancelAdding();
      return;
    }
    const normalized = normalize(raw);
    if (!isValidUrl(normalized)) {
      setError('Please enter a valid URL');
      return;
    }
    if (links().includes(normalized)) {
      setError('This URL has already been added');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const next = property().isMultiSelect
        ? [...links(), normalized]
        : [normalized];
      await ctx.onSave?.(property(), { valueType: 'LINK', values: next });
      cancelAdding();
    } catch {
      // mutation onError owns toast
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (url: string) => {
    if (isReadOnly() || isSaving()) return;
    setIsSaving(true);
    try {
      const next = links().filter((l) => l !== url);
      await ctx.onSave?.(property(), {
        valueType: 'LINK',
        values: next.length > 0 ? next : null,
      });
    } catch {
      // mutation onError owns toast
    } finally {
      setIsSaving(false);
    }
  };

  // Enter and Escape remove the focused input, which drops focus to the page.
  // A single link has no add button left, so focus goes to its chip.
  const returnFocus = () => {
    if (document.activeElement !== document.body) return;
    if (addButton?.isConnected) addButton.focus();
    else ctx.closeEditor();
  };

  const addFromKeyboard = async () => {
    await handleAddLink();
    if (!isAdding()) returnFocus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // An IME owns Enter and Escape while it composes; WebKit reports its
    // confirming keydown as 229 after composition ends.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      fireAndForget(addFromKeyboard(), 'property-editor');
    } else if (e.key === 'Escape') {
      if (isSaving()) return;
      e.preventDefault();
      cancelAdding();
      returnFocus();
    } else if (error()) {
      setError(null);
    }
  };

  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={links()}>
        {(url) => (
          <LinkChip
            url={url}
            canEdit={!isReadOnly()}
            isRemoving={isSaving()}
            onRemove={() => handleRemove(url)}
            badLinks={badLinks}
            markBad={(k) => setBadLinks(k, true)}
          />
        )}
      </For>

      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={!hasValue(property())}>
            <div class="text-ink-muted px-2 py-0.5 bg-transparent inline-block shrink-0 rounded-sm">
              {props.emptyValue ?? <PropertyEmpty label="Empty" />}
            </div>
          </Show>
        }
      >
        <Show
          when={isAdding()}
          fallback={
            <Show when={property().isMultiSelect || links().length === 0}>
              <button
                ref={addButton}
                type="button"
                class={ADD_BUTTON_CLASS}
                onClick={startAdding}
                disabled={isSaving()}
              >
                <Show
                  when={links().length === 0 && props.emptyValue}
                  fallback="+"
                >
                  {props.emptyValue}
                </Show>
              </button>
            </Show>
          }
        >
          <input
            ref={(el) => setTimeout(() => el.focus(), 0)}
            type="text"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setTimeout(() => {
                if (isAdding())
                  fireAndForget(handleAddLink(), 'property-editor');
              }, 100);
            }}
            placeholder="Enter URL..."
            readOnly={isSaving()}
            class="text-left px-2 py-0.5 bg-transparent focus:outline-none text-ink inline-block shrink-0 rounded-sm"
          />
          <Show when={error()}>
            <div class="text-failure-ink mt-1 w-full">{error()}</div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

type LinkChipProps = {
  url: string;
  canEdit: boolean;
  isRemoving: boolean;
  onRemove: () => void;
  badLinks: Record<string, true>;
  markBad: (key: string) => void;
};

const LinkChip: Component<LinkChipProps> = (props) => {
  const [imageError, setImageError] = createSignal(false);
  const [unfurl] = useUnfurl(props.url);
  const domain = extractDomain(props.url);

  const faviconUrl = () => {
    const data = unfurl();
    if (data?.type === 'success' && data.data.favicon_url) {
      return proxyResource(data.data.favicon_url);
    }
    return null;
  };

  const title = () => {
    const data = unfurl();
    if (data?.type === 'success' && data.data.title) return data.data.title;
    return domain;
  };

  const handleLinkClick = (e: MouseEvent) => {
    e.preventDefault();
    openExternalUrl(props.url);
  };

  return (
    <div class="group/link-chip inline-flex max-w-50 shrink-0 items-center rounded-sm hover:bg-hover">
      <button
        type="button"
        onClick={handleLinkClick}
        class="text-left px-2 py-0.5 bg-transparent text-ink inline-flex items-center gap-2 min-w-0 flex-1 cursor-default"
        title={props.url}
        disabled={props.isRemoving}
      >
        <div class="shrink-0 size-4 flex items-center justify-center">
          <Show
            when={
              faviconUrl() && !imageError() && !props.badLinks[faviconUrl()!]
            }
            fallback={<LinkIcon class="size-3.5 text-ink-muted" />}
          >
            <img
              src={faviconUrl()!}
              class="size-4 object-cover rounded-sm"
              crossorigin="anonymous"
              alt="favicon"
              onError={() => {
                setImageError(true);
                const f = faviconUrl();
                if (f) props.markBad(f);
              }}
            />
          </Show>
        </div>
        <span class="truncate flex-1 text-ink">{title()}</span>
      </button>
      {/* The remove button takes its own space so the title truncates before
          it; desktop shows it on hover or focus, touch always. */}
      <Show when={props.canEdit}>
        <button
          type="button"
          aria-label={t('entityActions.removeLink')}
          class="mr-1 size-4 touch:size-6 p-0.5 shrink-0 flex items-center justify-center text-ink-muted hover:text-failure-ink rounded-sm opacity-0 pointer-events-none not-touch:group-hover/link-chip:opacity-100 not-touch:group-hover/link-chip:pointer-events-auto group-focus-within/link-chip:opacity-100 group-focus-within/link-chip:pointer-events-auto touch:opacity-100 touch:pointer-events-auto"
          onClick={props.onRemove}
          disabled={props.isRemoving}
        >
          <DeleteIcon class="size-3 touch:size-4" />
        </button>
      </Show>
    </div>
  );
};
