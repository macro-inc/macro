import type { Property } from '@core/component/Properties/types';
import {
  extractDomain,
  PropertyDataTypeIcon,
} from '@core/component/Properties/utils';
import { Tooltip } from '@core/component/Tooltip';
import { useUnfurl } from '@core/signal/unfurl';
import { cornerClip } from '@core/util/clipPath';
import LinkIcon from '@icon/regular/link.svg';
import { proxyResource } from '@service-unfurl/client';
import { createSignal, For, Show } from 'solid-js';
import { PropertyPillTooltip } from './PropertyPillTooltip';

type LinkPropertyPillProps = {
  property: Property & { valueType: 'LINK' };
};

/**
 * Pill for link properties
 * Single value: shows unfurled title or domain with tooltip
 * Multi value: shows "Links (N)" with tooltip
 */
export const LinkPropertyPill = (props: LinkPropertyPillProps) => {
  const links = () => props.property.value ?? [];
  const count = () => links().length;

  if (count() === 0) return null;

  // Single link - show title/domain directly in pill
  if (count() === 1) {
    return <SingleLinkPill property={props.property} url={links()[0]} />;
  }

  // Multiple links - show count with tooltip
  return <MultiLinkPill property={props.property} urls={links()} />;
};

type SingleLinkPillProps = {
  property: Property & { valueType: 'LINK' };
  url: string;
};

const SingleLinkPill = (props: SingleLinkPillProps) => {
  const [unfurlData] = useUnfurl(props.url);
  const [imageError, setImageError] = createSignal(false);

  const title = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.title) {
      return data.data.title;
    }
    return extractDomain(props.url);
  };

  const faviconUrl = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.favicon_url) {
      return proxyResource(data.data.favicon_url);
    }
    return null;
  };

  return (
    <Tooltip
      tooltip={
        <SingleLinkTooltipContent
          property={props.property}
          url={props.url}
          title={title()}
          faviconUrl={faviconUrl()}
        />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <Show
            when={faviconUrl() && !imageError()}
            fallback={<LinkIcon class="size-4 text-ink-muted shrink-0" />}
          >
            <img
              src={faviconUrl()!}
              class="size-4 object-cover rounded shrink-0"
              crossorigin="anonymous"
              alt=""
              onError={() => setImageError(true)}
            />
          </Show>
          <span class="truncate max-w-[100px] hidden @3xl/soup:inline">
            {title()}
          </span>
        </div>
      </div>
    </Tooltip>
  );
};

type SingleLinkTooltipContentProps = {
  property: Property & { valueType: 'LINK' };
  url: string;
  title: string;
  faviconUrl: string | null;
};

const SingleLinkTooltipContent = (props: SingleLinkTooltipContentProps) => {
  const [imageError, setImageError] = createSignal(false);

  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <div
          class="p-px bg-edge box-border h-fit w-fit flex items-center"
          style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
        >
          <a
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
            style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
            title={props.url}
          >
            <Show
              when={props.faviconUrl && !imageError()}
              fallback={<LinkIcon class="size-4 text-ink-muted" />}
            >
              <img
                src={props.faviconUrl!}
                class="size-4 object-cover rounded"
                crossorigin="anonymous"
                alt=""
                onError={() => setImageError(true)}
              />
            </Show>
            <span class="truncate max-w-[150px]">{props.title}</span>
          </a>
        </div>
      </div>
    </PropertyPillTooltip>
  );
};

type MultiLinkPillProps = {
  property: Property & { valueType: 'LINK' };
  urls: string[];
};

const MultiLinkPill = (props: MultiLinkPillProps) => {
  return (
    <Tooltip
      tooltip={
        <LinkTooltipContent property={props.property} urls={props.urls} />
      }
      floatingOptions={{
        offset: 4,
        flip: true,
        shift: { padding: 8 },
      }}
    >
      <div
        class="p-px bg-edge box-border h-fit flex items-center"
        style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
      >
        <div
          class="inline-flex items-center gap-1.5 p-1.5 @3xl/soup:px-2 @3xl/soup:py-1 text-xs leading-none text-ink-muted bg-panel box-border"
          style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        >
          <PropertyDataTypeIcon
            property={{
              data_type: 'LINK',
            }}
            class="size-3.5 shrink-0"
          />
          <span class="truncate max-w-[120px] hidden @3xl/soup:inline">
            {props.property.displayName} ({props.urls.length})
          </span>
        </div>
      </div>
    </Tooltip>
  );
};

type LinkTooltipContentProps = {
  property: Property & { valueType: 'LINK' };
  urls: string[];
};

const LinkTooltipContent = (props: LinkTooltipContentProps) => {
  return (
    <PropertyPillTooltip property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={props.urls}>{(url) => <LinkValuePill url={url} />}</For>
      </div>
    </PropertyPillTooltip>
  );
};

type LinkValuePillProps = {
  url: string;
};

const LinkValuePill = (props: LinkValuePillProps) => {
  const [unfurlData] = useUnfurl(props.url);
  const [imageError, setImageError] = createSignal(false);

  const title = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.title) {
      return data.data.title;
    }
    return extractDomain(props.url);
  };

  const faviconUrl = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.favicon_url) {
      return proxyResource(data.data.favicon_url);
    }
    return null;
  };

  return (
    <div
      class="p-px bg-edge box-border h-fit w-fit flex items-center"
      style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
    >
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
        style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
        title={props.url}
      >
        <Show
          when={faviconUrl() && !imageError()}
          fallback={<LinkIcon class="size-4 text-ink-muted" />}
        >
          <img
            src={faviconUrl()!}
            class="size-4 object-cover rounded"
            crossorigin="anonymous"
            alt=""
            onError={() => setImageError(true)}
          />
        </Show>
        <span class="truncate max-w-[150px]">{title()}</span>
      </a>
    </div>
  );
};
