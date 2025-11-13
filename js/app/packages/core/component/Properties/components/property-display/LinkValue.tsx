import { useBlockId } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import { useUnfurl } from '@core/signal/unfurl';
import DeleteIcon from '@icon/bold/x-bold.svg';
import LinkIcon from '@icon/regular/link.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { proxyResource } from '@service-unfurl/client';
import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { savePropertyValue } from '../../api/propertyValues';
import type { Property } from '../../types';
import { extractDomain, isValidUrl, normalizeUrl } from '../../utils';

type LinkValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onRefresh?: () => void;
};

const [badLinks, setBadLinks] = createStore<Record<string, true>>({});

export const LinkValue: Component<LinkValueProps> = (props) => {
  const blockId = useBlockId();
  const [isAdding, setIsAdding] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [hoveredLink, setHoveredLink] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const linkValues = (props.property.value || []) as string[];
  const hasLinks = () => linkValues.length > 0;
  const isMultiValue = () => props.property.isMultiSelect;

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

      const result = await savePropertyValue(
        blockId,
        props.entityType,
        props.property,
        {
          valueType: 'LINK',
          values: newValues,
        }
      );

      if (result.ok) {
        cancelAdding();
        props.onRefresh?.();
      } else {
        setError('Failed to save link');
      }
    } catch (_err) {
      setError('Failed to save link');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveLink = async (url: string) => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const newValues = linkValues.filter((link) => link !== url);

      const result = await savePropertyValue(
        blockId,
        props.entityType,
        props.property,
        {
          valueType: 'LINK',
          values: newValues.length > 0 ? newValues : null,
        }
      );

      if (result.ok) {
        props.onRefresh?.();
      }
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
    <div>
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
        class="text-left text-xs px-2 py-1 border border-edge bg-transparent focus:outline-none focus:border-accent text-ink"
      />
      <Show when={error()}>
        <div class="text-failure-ink text-xs mt-1">{error()}</div>
      </Show>
    </div>
  );

  return (
    <Show
      when={isMultiValue()}
      fallback={
        <Show
          when={hasLinks()}
          fallback={
            <Show
              when={isAdding()}
              fallback={
                <button
                  onClick={startAdding}
                  class={`text-left text-xs px-2 py-1 border border-edge ${
                    isReadOnly()
                      ? 'bg-transparent text-ink-muted cursor-default'
                      : 'hover:bg-hover cursor-pointer bg-transparent text-ink'
                  } inline-block max-w-full`}
                  disabled={isReadOnly()}
                >
                  —
                </button>
              }
            >
              <AddLinkInput />
            </Show>
          }
        >
          <LinkDisplay
            url={linkValues[0]}
            onRemove={() => handleRemoveLink(linkValues[0])}
            canEdit={!isReadOnly()}
            isRemoving={isSaving()}
            hoveredLink={hoveredLink()}
            setHoveredLink={setHoveredLink}
          />
        </Show>
      }
    >
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
            />
          )}
        </For>
        <Show when={!isReadOnly()}>
          <Show
            when={isAdding()}
            fallback={
              <button
                onClick={startAdding}
                class="text-ink-muted hover:text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0"
              >
                +
              </button>
            }
          >
            <div class="inline-block">
              <AddLinkInput />
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
};

type LinkDisplayProps = {
  url: string;
  onRemove: () => void;
  canEdit: boolean;
  isRemoving: boolean;
  hoveredLink: string | null;
  setHoveredLink: (url: string | null) => void;
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
      class="relative inline-block max-w-[225px] shrink-0"
      onMouseEnter={() => props.setHoveredLink(props.url)}
      onMouseLeave={() => props.setHoveredLink(null)}
    >
      <button
        onClick={handleLinkClick}
        class={`text-left text-xs px-2 py-1 border border-edge cursor-pointer bg-transparent text-ink inline-flex items-center gap-2 w-full ${
          props.canEdit ? 'hover:bg-hover' : ''
        }`}
        title={props.url}
        disabled={props.isRemoving}
      >
        <div class="shrink-0 w-4 h-4 flex items-center justify-center">
          <Show
            when={faviconUrl() && !imageError() && !badLinks[faviconUrl()!]}
            fallback={<LinkIcon class="w-3.5 h-3.5 text-ink-muted" />}
          >
            <img
              src={faviconUrl()!}
              class="w-4 h-4 object-cover rounded-sm"
              crossorigin="anonymous"
              alt="favicon"
              onError={() => {
                setImageError(true);
                if (faviconUrl()) {
                  setBadLinks(faviconUrl()!, true);
                }
              }}
            />
          </Show>
        </div>

        <span class="truncate flex-1 text-ink">{title()}</span>

        <Show when={props.canEdit && isHovered() && !props.isRemoving}>
          <div class={`shrink-0 w-4 h-4 flex items-center justify-center`}>
            <IconButton
              icon={DeleteIcon}
              theme="clear"
              size="xs"
              class="!text-failure hover:!bg-failure/15"
              tooltip={{ label: 'Remove link' }}
              onClick={handleRemoveClick}
            />
          </div>
        </Show>
      </button>
    </div>
  );
};
