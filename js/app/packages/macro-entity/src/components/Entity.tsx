import { getEntityIconConfig } from 'core/component/EntityIcon';
import { StaticMarkdown } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from 'core/component/LexicalMarkdown/theme';
import type { Component, JSX, ParentProps, Ref } from 'solid-js';
import { children, createMemo, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { formatDocumentName } from '@service-storage/util/filename';
import { createProfilePictureQuery } from '../queries/auth';
import type { EntityData } from '../types/entity';
import type { EntityClickHandler } from './EntityWithEverything';

interface EntityProps<T extends EntityData> extends ParentProps {
  entity: T;
  timestamp?: number;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  iconClass?: string;
  onClick?: EntityClickHandler<T>;
  ref?: Ref<HTMLDivElement>;
}

export function Entity<T extends EntityData = EntityData>(
  props: EntityProps<T>
) {
  const iconConfig = createMemo(() => getEntityIconConfig(props.entity));

  const content = children(() => {
    if (props.children) return props.children;

    switch (props.entity.type) {
      case 'channel':
        return (
          <Show when={props.entity.latestMessage}>
            {(latestMessage) => (
              <StaticMarkdown
                markdown={latestMessage().content}
                theme={unifiedListMarkdownTheme}
                singleLine={true}
              />
            )}
          </Show>
        );
      case 'email':
        return (
          <p>
            <span class="font-semibold mr-2 text-ink">
              {props.entity.senderName}
            </span>
            <span class="text-ink-muted">{props.entity.snippet}</span>
          </p>
        );
      default:
        return props.children;
    }
  });

  const formattedDate = createMemo(() => {
    const timestamp = props.timestamp ?? props.entity.updatedAt;
    if (!timestamp) return;
    const date = new Date(timestamp);
    const currentDate = new Date();

    if (date.getDate() === currentDate.getDate())
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

    if (date.getFullYear() === currentDate.getFullYear())
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  });

  const displayName = createMemo(() => {
    if (props.entity.type === 'document') {
      return formatDocumentName(props.entity.name, props.entity.fileType, {
        fullyQualifiedBlockName: true,
      });
    }
    return props.entity.name;
  });

  return (
    <div
      data-entity
      data-entity-id={props.entity.id}
      class="@md:flex grid w-full min-w-0 flex-1 grid-cols-2 @md:flex-row @md:items-center @md:gap-4"
      ref={props.ref}
      onClick={props.onClick ? [props.onClick, props.entity] : undefined}
      role="button"
      tabIndex={0}
    >
      {/* Icon and name - top left on mobile, first item on desktop */}
      <div class="order-1 flex flex-row items-center gap-2">
        <div class="flex @md:size-6 size-4 shrink-0 items-center justify-center">
          <Dynamic
            component={props.icon ?? iconConfig().icon}
            class={`flex size-full ${props.iconClass ?? iconConfig().foreground}`}
          />
        </div>
        <span class="@md:w-52 truncate font-medium text-sm">
          {displayName()}
        </span>
      </div>

      {/* Content - full width bottom row on mobile, middle on desktop  */}
      <div class="@md:order-2 order-3 col-span-2 flex min-h-10 w-full min-w-0 flex-1 items-center font-medium text-sm">
        <div class="line-clamp-1 w-full">{content()}</div>
      </div>

      {/* Date and user - top right on mobile, end on desktop  */}
      <div class="@md:order-3 order-2 @md:ml-5 flex flex-row items-center justify-end gap-2.5">
        <Show when={formattedDate()}>
          {(date) => (
            <span class="whitespace-nowrap font-medium text-sm">{date()}</span>
          )}
        </Show>
        <div class="@md:flex hidden size-8 items-center justify-center">
          <UserIcon id={props.entity.ownerId} />
        </div>
      </div>
    </div>
  );
}

// SCUFFED THEME: how do we want to handle these colors?
function UserIcon(props: { id: string; name?: string }) {
  const fallbackName = () => props.name || props.id.replace('macro|', '');
  const Fallback = () => (
    <span class="flex size-8 items-center justify-center rounded-full bg-[oklch(0.551_0.027_264.364)]">
      <span class="font-medium text-sm text-white">
        {fallbackName().charAt(0).toUpperCase()}
      </span>
    </span>
  );

  if (!props.id.startsWith('macro|')) return <Fallback />;

  const profilePicQuery = createProfilePictureQuery(props.id);
  const Loading = () => (
    <div class="flex size-8 animate-pulse rounded-full bg-[oklch(0.446_0.03_256.802)]" />
  );
  return (
    <Suspense fallback={<Loading />}>
      <Show when={profilePicQuery.data?.url} fallback={<Fallback />}>
        {(url) => (
          <img
            src={url()}
            class="inline-block size-8 rounded-full bg-[oklch(0.551_0.027_264.364)]"
          />
        )}
      </Show>
    </Suspense>
  );
}
