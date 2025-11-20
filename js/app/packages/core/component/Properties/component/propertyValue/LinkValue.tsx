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
import { saveEntityProperty } from '../../api';
import type { Property } from '../../types';
import { extractDomain, isValidUrl, normalizeUrl } from '../../utils';
import { ERROR_MESSAGES } from '../../utils/errorHandling';
import { AddPropertyValueButton, EmptyValue } from './ValueComponents';

type LinkValueProps = {
  property: Property;
  canEdit: boolean;
  entityType: EntityType;
  onRefresh?: () => void;
};

export const LinkValue: Component<LinkValueProps> = (props) => {
  const blockId = useBlockId();
  const [isAdding, setIsAdding] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [hoveredLink, setHoveredLink] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [badLinks, setBadLinks] = createStore<Record<string, true>>({});

  const isReadOnly = () => props.property.isMetadata || !props.canEdit;
  const linkValues = (props.property.value ?? []) as string[];

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

      const result = await saveEntityProperty(
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
        setError(ERROR_MESSAGES.PROPERTY_SAVE);
      }
    } catch (_err) {
      setError(ERROR_MESSAGES.PROPERTY_SAVE);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveLink = async (url: string) => {
    if (isReadOnly() || isSaving()) return;

    setIsSaving(true);

    try {
      const newValues = linkValues.filter((link) => link !== url);

      const result = await saveEntityProperty(
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
        class="text-left text-xs px-2 py-1 border border-edge bg-transparent focus:outline-none focus:border-accent text-ink inline-block shrink-0"
      />
      <Show when={error()}>
        <div class="text-failure-ink text-xs mt-1 w-full">{error()}</div>
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
            <div class="text-ink-muted text-xs px-2 py-1 border border-edge bg-transparent inline-block shrink-0">
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
      class="relative inline-flex max-w-[200px] shrink-0"
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
            when={
              faviconUrl() && !imageError() && !props.badLinks[faviconUrl()!]
            }
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
                  props.setBadLinks(faviconUrl()!, true);
                }
              }}
            />
          </Show>
        </div>

        <span class="truncate flex-1 text-ink">{title()}</span>
      </button>
      <Show when={props.canEdit && isHovered() && !props.isRemoving}>
        <div class="absolute right-1 inset-y-0 flex items-center">
          <IconButton
            icon={DeleteIcon}
            theme="clear"
            size="xs"
            class="!text-failure !bg-[#2a2a2a] hover:!bg-[#444444] !cursor-pointer !w-4 !h-4 !min-w-4 !min-h-4"
            onClick={handleRemoveClick}
          />
        </div>
      </Show>
    </div>
  );
};
