import { useUnfurl } from '@core/signal/unfurl';
import DeleteIcon from '@icon/bold/x-bold.svg';
import LinkIcon from '@icon/regular/link.svg';
import { proxyResource } from '@service-unfurl/client';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  extractDomain,
  getLinkValues,
  isValidUrl,
  normalizeUrl,
} from '../../utils';
import {
  AddPropertyValueButton,
  EmptyValue,
  type PropertyValueProps,
  stubSaveHandler,
} from './ValueComponents';

export const LinkValue: Component<PropertyValueProps> = (props) => {
  const saveHandler = () => props.saveHandler ?? stubSaveHandler;
  const [isAdding, setIsAdding] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [hoveredLink, setHoveredLink] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [badLinks, setBadLinks] = createStore<Record<string, true>>({});

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const linkValues = getLinkValues(props.property);

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

  const handleAddLink = async () => {
    const value = inputValue().trim();
    if (!value) {
      cancelAdding();
      return;
    }

    const normalized = normalizeUrl(value);
    if (!isValidUrl(normalized)) {
      setError('Please enter a valid URL');
      return;
    }

    if (linkValues.includes(normalized)) {
      setError('This URL has already been added');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let newValues: string[];
      if (props.property.isMultiSelect) {
        newValues = [...linkValues, normalized];
      } else {
        newValues = [normalized];
      }

      await saveHandler().saveProperty(props.property, {
        valueType: 'LINK',
        values: newValues,
      });
      cancelAdding();
      props.onRefresh?.();
    } catch {
      // Error toast is shown by mutation's onError callback
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveLink = async (url: string) => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const newValues = linkValues.filter((link: string) => link !== url);

      await saveHandler().saveProperty(props.property, {
        valueType: 'LINK',
        values: newValues.length > 0 ? newValues : null,
      });
      props.onRefresh?.();
    } catch {
      // Error toast is shown by mutation's onError callback
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

  const AddLinkInput = () => (
    <>
      <input
        ref={(el) => {
          setTimeout(() => el.focus(), 0);
        }}
        type="text"
        value={inputValue()}
        onInput={(e) => setInputValue(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setTimeout(() => {
            if (isAdding()) {
              handleAddLink();
            }
          }, 100);
        }}
        placeholder="Enter URL..."
        disabled={isSaving()}
        class="text-left px-2 py-0.5 border border-edge-muted bg-transparent focus:outline-none focus:border-accent text-ink inline-block shrink-0"
      />
      <Show when={error()}>
        <div class="text-failure-ink mt-1 w-full">{error()}</div>
      </Show>
    </>
  );

  return (
    <div class="flex flex-wrap gap-1 justify-start items-start w-full min-w-0">
      <For each={linkValues}>
        {(url) => (
          <LinkDisplay
            url={url}
            onRemove={() => handleRemoveLink(url)}
            canEdit={!isReadOnly()}
            isRemoving={isSaving()}
            hoveredLink={hoveredLink()}
            setHoveredLink={setHoveredLink}
            badLinks={badLinks}
            setBadLinks={setBadLinks}
          />
        )}
      </For>
      <Show
        when={!isReadOnly()}
        fallback={
          <Show when={linkValues.length === 0}>
            <div class="text-ink-muted px-2 py-0.5 border border-edge-muted bg-transparent inline-block shrink-0">
              <EmptyValue />
            </div>
          </Show>
        }
      >
        <Show
          when={isAdding()}
          fallback={
            <Show
              when={props.property.isMultiSelect || linkValues.length === 0}
            >
              <AddPropertyValueButton onClick={startAdding} />
            </Show>
          }
        >
          <AddLinkInput />
        </Show>
      </Show>
    </div>
  );
};

type LinkDisplayProps = {
  url: string;
  onRemove: () => void;
  canEdit: boolean;
  isRemoving: boolean;
  hoveredLink: string | null;
  setHoveredLink: (url: string | null) => void;
  badLinks: Record<string, true>;
  setBadLinks: (key: string, value: true) => void;
};

const LinkDisplay: Component<LinkDisplayProps> = (props) => {
  const [imageError, setImageError] = createSignal(false);
  const [unfurlData] = useUnfurl(props.url);
  const domain = extractDomain(props.url);

  const handleLinkClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.remove-button')) {
      return;
    }
    e.preventDefault();
    window.open(props.url, '_blank');
  };

  const handleRemoveClick = () => {
    props.onRemove();
  };

  const faviconUrl = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.favicon_url) {
      return proxyResource(data.data.favicon_url);
    }
    return null;
  };

  const title = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.title) {
      return data.data.title;
    }
    return domain;
  };

  const isHovered = () => props.hoveredLink === props.url;

  return (
    <div
      class="relative inline-flex max-w-50 shrink-0"
      onMouseEnter={() => props.setHoveredLink(props.url)}
      onMouseLeave={() => props.setHoveredLink(null)}
    >
      <button
        onClick={handleLinkClick}
        class="text-left px-2 py-0.5 border border-edge-muted bg-transparent text-ink inline-flex items-center gap-2 w-full cursor-default"
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
                if (faviconUrl()) {
                  props.setBadLinks(faviconUrl()!, true);
                }
              }}
            />
          </Show>
        </div>

        <span class="truncate flex-1 text-ink">{title()}</span>
      </button>
      <Show when={props.canEdit && isHovered() && !props.isRemoving}>
        <div class="absolute right-0 inset-y-0 flex items-center pr-1 pl-2 bg-linear-to-r from-transparent to-hover to-40%">
          <button
            onClick={handleRemoveClick}
            disabled={props.isRemoving}
            class="size-4 p-0.5 flex items-center justify-center text-ink-muted hover:text-failure-ink"
          >
            <DeleteIcon class="size-3" />
          </button>
        </div>
      </Show>
    </div>
  );
};
