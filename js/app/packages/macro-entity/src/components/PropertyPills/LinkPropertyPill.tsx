import type { Property } from '@core/component/Properties/types';
import {
  extractDomain,
  PropertyDataTypeIcon,
} from '@core/component/Properties/utils';
import { useUnfurl } from '@core/signal/unfurl';
import { cornerClip } from '@core/util/clipPath';
import LinkIcon from '@icon/regular/link.svg';
import { proxyResource } from '@service-unfurl/client';
import { createSignal, Show } from 'solid-js';

type LinkPropertyPillProps = {
  property: Property & { valueType: 'LINK' };
};

/**
 * Pill for link properties
 * Single value: shows unfurled title or domain
 * Multi value: shows "Links (N)"
 */
export function LinkPropertyPill(props: LinkPropertyPillProps) {
  const links = () => props.property.value ?? [];
  const count = () => links().length;

  if (count() === 0) return null;

  // Single link - show title/domain directly in pill
  if (count() === 1) {
    return <SingleLinkPill property={props.property} url={links()[0]} />;
  }

  // Multiple links - show count
  return <MultiLinkPill property={props.property} urls={links()} />;
}

type SingleLinkPillProps = {
  property: Property & { valueType: 'LINK' };
  url: string;
};

function SingleLinkPill(props: SingleLinkPillProps) {
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
      class="p-px bg-edge box-border h-fit flex items-center"
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
        <span class="truncate max-w-[100px]">{title()}</span>
      </a>
    </div>
  );
}

type MultiLinkPillProps = {
  property: Property & { valueType: 'LINK' };
  urls: string[];
};

function MultiLinkPill(props: MultiLinkPillProps) {
  return (
    <div
      class="p-px bg-edge box-border h-fit flex items-center"
      style={{ 'clip-path': cornerClip('0.2rem', 0, 0, 0) }}
    >
      <div
        class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted bg-panel box-border"
        style={{ 'clip-path': cornerClip('calc(0.2rem - 0.5px)', 0, 0, 0) }}
      >
        <PropertyDataTypeIcon
          property={{
            data_type: 'LINK',
          }}
        />
        <span class="truncate max-w-[120px]">
          {props.property.displayName} ({props.urls.length})
        </span>
      </div>
    </div>
  );
}
