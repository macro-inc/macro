import Building from '@icon/regular/buildings.svg?component-solid';
import { proxyResource } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import { Show } from 'solid-js';

export function CompanyProfile(props: {
  domain: string;
  unfurlData: GetUnfurlResponse | null;
}) {
  // Remove @ prefix for display
  const domainName = props.domain.substring(1);

  // Get proxied image URL
  const imageUrl = () => {
    if (props.unfurlData?.image_url) {
      return proxyResource(props.unfurlData.image_url);
    } else if (props.unfurlData?.favicon_url) {
      return proxyResource(props.unfurlData.favicon_url);
    }
    return null;
  };

  return (
    <div class="flex gap-6">
      {/* Company Logo/Icon */}
      <div class="w-32 h-32 aspect-square rounded-lg overflow-hidden bg-edge/30 flex items-center justify-center">
        <Show
          when={imageUrl()}
          fallback={<Building class="w-16 h-16 text-ink-extra-muted" />}
        >
          <img
            src={imageUrl()!}
            alt={domainName}
            class="w-full h-full object-contain"
            onError={(e) => {
              // If image fails to load, hide it and show fallback
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </Show>
      </div>

      {/* Company Details */}
      <div class="flex-1 space-y-4">
        <div class="space-y-2">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-ink-muted min-w-[60px]">
              Domain:
            </span>
            <span class="text-base text-ink truncate flex-1">{domainName}</span>
          </div>

          <Show when={props.unfurlData?.title}>
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-medium text-ink-muted min-w-[60px]">
                Name:
              </span>
              <span class="text-base text-ink truncate flex-1">
                {props.unfurlData!.title}
              </span>
            </div>
          </Show>

          <Show when={props.unfurlData?.description}>
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-medium text-ink-muted min-w-[60px]">
                About:
              </span>
              <span class="text-sm text-ink flex-1 line-clamp-2">
                {props.unfurlData!.description}
              </span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
