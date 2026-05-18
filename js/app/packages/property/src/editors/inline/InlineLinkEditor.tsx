import { useUnfurl } from '@core/signal/unfurl';
import LinkIcon from '@phosphor/link.svg';
import DeleteIcon from '@phosphor/x.svg';
import { proxyResource } from '@service-unfurl/client';
import { type Component, createSignal, For, Show } from 'solid-js';
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
export function InlineLinkEditor() {
  const ctx = useProperty();

  const [isAdding, setIsAdding] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [hoveredLink, setHoveredLink] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [badLinks, setBadLinks] = createStore<Record<string, true>>({});

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
      ctx.onRefresh?.();
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
      ctx.onRefresh?.();
    } catch {
      // mutation onError owns toast
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelAdding();
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
            hovered={hoveredLink() === url}
            onMouseEnter={() => setHoveredLink(url)}
            onMouseLeave={() => setHoveredLink(null)}
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
              <PropertyEmpty label="Empty" />
            </div>
          </Show>
        }
      >
        <Show
          when={isAdding()}
          fallback={
            <Show when={property().isMultiSelect || links().length === 0}>
              <button
                type="button"
                class={ADD_BUTTON_CLASS}
                onClick={startAdding}
                disabled={isSaving()}
              >
                +
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
                if (isAdding()) handleAddLink();
              }, 100);
            }}
            placeholder="Enter URL..."
            disabled={isSaving()}
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
  hovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
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
    if ((e.target as HTMLElement).closest('.remove-button')) return;
    e.preventDefault();
    window.open(props.url, '_blank');
  };

  return (
    <div
      class="relative inline-flex max-w-50 shrink-0 rounded-sm hover:bg-hover"
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <button
        type="button"
        onClick={handleLinkClick}
        class="text-left px-2 py-0.5 bg-transparent text-ink inline-flex items-center gap-2 w-full cursor-default"
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
      <Show when={props.canEdit && props.hovered && !props.isRemoving}>
        <div class="absolute right-0 inset-y-0 flex items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40% rounded-r-sm">
          <button
            type="button"
            class="remove-button size-4 p-0.5 flex items-center justify-center text-ink-muted hover:text-failure-ink rounded-sm"
            onClick={props.onRemove}
            disabled={props.isRemoving}
          >
            <DeleteIcon class="size-3" />
          </button>
        </div>
      </Show>
    </div>
  );
};
