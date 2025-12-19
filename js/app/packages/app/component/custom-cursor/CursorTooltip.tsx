import { TOKENS } from '@core/hotkey/tokens';
import { Hotkey } from '@core/component/Hotkey';
import { cornerClip } from '@core/util/clipPath';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';

type ChannelMessage = {
  sender: string;
  content: string;
};

type EntityInfo = {
  id: string;
  name: string;
  type: string;
  description: string;
  messages?: ChannelMessage[];
};

// Action button component
function ActionButton(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col items-center gap-1">
      <div
        class="flex items-center justify-center px-2 py-1 border font-mono text-[0.625rem]"
        style={{
          'border-color': 'oklch(var(--a0l) var(--a0c) var(--a0h))',
          'background-color': 'var(--color-menu)',
          color: 'oklch(var(--a0l) var(--a0c) var(--a0h))',
          'min-width': '28px',
        }}
      >
        {props.children}
      </div>
      <span
        class="text-[0.5rem] font-mono uppercase tracking-wider"
        style={{ color: 'oklch(var(--a0l) var(--a0c) var(--a0h) / 0.6)' }}
      >
        {props.label}
      </span>
    </div>
  );
}

export function CursorTooltip() {
  const [isOptionHeld, setIsOptionHeld] = createSignal(false);
  const [isOverLink, setIsOverLink] = createSignal(false);
  const [hoveredEntity, setHoveredEntity] = createSignal<EntityInfo | null>(null);

  // Refs for direct DOM manipulation (more performant than reactive state)
  let containerRef: HTMLDivElement | undefined;
  let svgRef: SVGSVGElement | undefined;
  let line1Ref: SVGLineElement | undefined;
  let line2Ref: SVGLineElement | undefined;
  let line3Ref: SVGLineElement | undefined;

  // Offset for tooltip position
  const OFFSET = 20;

  const handleMouseMove = (e: MouseEvent) => {
    const x = e.clientX;
    const y = e.clientY;

    // Update CSS custom properties directly on the container (bypasses reactive system)
    if (containerRef) {
      containerRef.style.setProperty('--cursor-x', `${x + OFFSET}px`);
      containerRef.style.setProperty('--cursor-y', `${y + OFFSET}px`);
    }

    // Update SVG lines directly for better performance
    if (line1Ref) {
      line1Ref.setAttribute('x1', String(x));
      line1Ref.setAttribute('y1', String(y));
      line1Ref.setAttribute('x2', String(x + OFFSET));
      line1Ref.setAttribute('y2', String(y + OFFSET));
    }
    if (line2Ref) {
      line2Ref.setAttribute('x1', String(x + 2));
      line2Ref.setAttribute('y1', String(y + 2));
      line2Ref.setAttribute('x2', String(x + OFFSET + 2));
      line2Ref.setAttribute('y2', String(y + OFFSET + 2));
    }
    if (line3Ref) {
      line3Ref.setAttribute('x1', String(x - 2));
      line3Ref.setAttribute('y1', String(y - 2));
      line3Ref.setAttribute('x2', String(x + OFFSET - 2));
      line3Ref.setAttribute('y2', String(y + OFFSET - 2));
    }

    // Check Alt/Option key state from mouse event (more reliable)
    setIsOptionHeld(e.altKey);

    // Check if hovering over a link - check multiple ways
    const element = document.elementFromPoint(x, y);
    if (!element) {
      setIsOverLink(false);
      setHoveredEntity(null);
      return;
    }
    
    // Check for entity first
    const entityElement = element.closest('[data-entity]');
    if (entityElement) {
      const entityId = entityElement.getAttribute('data-entity-id');
      if (entityId) {
        // Only update if entity changed to avoid unnecessary re-renders
        const currentEntity = hoveredEntity();
        if (!currentEntity || currentEntity.id !== entityId) {
          // Get entity type
          const type = entityElement.getAttribute('data-entity-type') || 'entity';
          
          let name = 'Entity';
          let description = '';
          let messages: ChannelMessage[] | undefined;
          
          if (type === 'channel') {
            // For channels, the structure is:
            // - Channel name in span.font-semibold.truncate
            // - Sender name in span.font-medium.shrink-0.truncate (NOT the channel name)
            // - Message in div.opacity-60
            const channelNameEl = entityElement.querySelector('span.font-semibold.truncate');
            name = channelNameEl?.textContent?.trim() || 'Channel';
            
            // Find sender - it's in a span with font-medium shrink-0 truncate, but NOT the channel name container
            const senderEl = entityElement.querySelector('span.font-medium.shrink-0.truncate');
            const messageEl = entityElement.querySelector('[class*="opacity-60"]');
            
            const sender = senderEl?.textContent?.trim() || '';
            const content = messageEl?.textContent?.trim() || '';
            
            if (sender || content) {
              messages = [{ sender: sender || 'Unknown', content }];
            }
          } else {
            // For non-channels, extract name and description normally
            const nameElement = entityElement.querySelector('span.truncate.font-medium') ||
                              entityElement.querySelector('[class*="truncate"][class*="font-medium"]');
            name = nameElement?.textContent?.trim() || 'Entity';
            
            // Extract description text
            const descriptionElement = 
              entityElement.querySelector('[class*="opacity-60"]') ||
              entityElement.querySelector('[class*="text-ink-muted"]') ||
              entityElement.querySelector('[class*="line-clamp"]');
            description = descriptionElement?.textContent?.trim() || '';
          }
          
          setHoveredEntity({
            id: entityId,
            name,
            type,
            description,
            messages,
          });
        }
        setIsOverLink(false);
        return;
      }
    }
    
    if (hoveredEntity() !== null) {
      setHoveredEntity(null);
    }
    
    // Check for link in multiple ways
    const link = element.closest('a[href]') || 
                 (element.tagName === 'A' && element.hasAttribute('href')) ||
                 element.closest('[role="link"]');
    const newIsOverLink = !!link;
    if (isOverLink() !== newIsOverLink) {
      setIsOverLink(newIsOverLink);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Handle both Option (Mac) and Alt (non-Mac) keys
    if (e.altKey || e.key === 'Alt') {
      setIsOptionHeld(true);
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    // Release when Alt/Option key is released
    if (e.key === 'Alt' || !e.altKey) {
      setIsOptionHeld(false);
    }
  };

  onMount(() => {
    // Add event listeners
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  });

  createEffect(() => {
    onCleanup(() => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    });
  });

  const showLinkTooltip = () => isOptionHeld() && isOverLink();
  const showEntityTooltip = () => hoveredEntity() !== null;

  // Accent color for styling
  const accentColor = 'oklch(var(--a0l) var(--a0c) var(--a0h))';

  return (
    <Portal mount={document.body}>
      <Show when={showLinkTooltip() || showEntityTooltip()}>
        {/* Container for CSS variable positioning */}
        <div
          ref={containerRef}
          style={{
            '--cursor-x': '0px',
            '--cursor-y': '0px',
          }}
        >
          {/* SVG overlay for the wire - parallel lines aesthetic */}
          <svg
            ref={svgRef}
            class="fixed pointer-events-none"
            style={{
              top: '0',
              left: '0',
              width: '100vw',
              height: '100vh',
              'pointer-events': 'none',
              'z-index': '999998',
            }}
          >
            {/* Multiple parallel lines - positioned via direct DOM manipulation */}
            <line
              ref={line1Ref}
              x1="0"
              y1="0"
              x2="0"
              y2="0"
              stroke={accentColor}
              stroke-width="2"
              opacity="0.9"
            />
            <line
              ref={line2Ref}
              x1="0"
              y1="0"
              x2="0"
              y2="0"
              stroke={accentColor}
              stroke-width="1"
              opacity="0.5"
            />
            <line
              ref={line3Ref}
              x1="0"
              y1="0"
              x2="0"
              y2="0"
              stroke={accentColor}
              stroke-width="1"
              opacity="0.5"
            />
          </svg>

          {/* Link Tooltip - Brand styled, positioned via CSS custom properties */}
          <Show when={showLinkTooltip()}>
            <div
              class="fixed pointer-events-none shadow-lg"
              style={{
                left: 'var(--cursor-x)',
                top: 'var(--cursor-y)',
                'z-index': '999999',
                'clip-path': cornerClip(0, '0.5rem', 0, 0),
                'will-change': 'left, top',
              }}
            >
              {/* Outer border container */}
              <div
                class="p-[2px]"
                style={{
                  background: accentColor,
                  'clip-path': cornerClip(0, '0.5rem', 0, 0),
                }}
              >
                {/* Inner content */}
                <div
                  class="px-3 py-2 font-mono text-xs uppercase tracking-wider"
                  style={{
                    'background-color': 'var(--color-menu)',
                    color: accentColor,
                    'clip-path': cornerClip(0, 'calc(0.5rem - 2px)', 0, 0),
                  }}
                >
                  Open in new tab
                </div>
              </div>
            </div>
          </Show>

          {/* Entity Tooltip - Brand styled, positioned via CSS custom properties */}
          <Show when={showEntityTooltip()}>
            <div
              class="fixed pointer-events-none shadow-lg"
              style={{
                left: 'var(--cursor-x)',
                top: 'var(--cursor-y)',
                'z-index': '999999',
                'min-width': '200px',
                'max-width': '280px',
                'will-change': 'left, top',
              }}
            >
              {/* Outer border container */}
              <div
                class="p-[2px]"
                style={{
                  background: accentColor,
                  'clip-path': cornerClip(0, '0.75rem', 0, 0),
                }}
              >
                {/* Main container */}
                <div
                  style={{
                    'background-color': 'var(--color-menu)',
                    'clip-path': cornerClip(0, 'calc(0.75rem - 2px)', 0, 0),
                  }}
                >
                  {/* Header bar with accent background */}
                  <div
                    class="px-3 py-1 font-mono text-xs font-semibold truncate"
                    style={{
                      'background-color': accentColor,
                      color: 'var(--color-menu)',
                      'clip-path': cornerClip(0, 'calc(0.75rem - 2px)', 0, 0),
                    }}
                  >
                    {hoveredEntity()?.name}
                  </div>

                  {/* Body content */}
                  <div class="px-3 py-2">
                    {/* Channel messages */}
                    <Show when={hoveredEntity()?.type === 'channel' && hoveredEntity()?.messages?.length}>
                      <div class="flex flex-col gap-2 mb-3">
                        <For each={hoveredEntity()?.messages}>
                          {(msg) => (
                            <div class="flex flex-col gap-0.5">
                              <div
                                class="text-[0.625rem] font-semibold"
                                style={{ color: accentColor }}
                              >
                                {msg.sender}
                              </div>
                              <div
                                class="text-[0.625rem] line-clamp-2"
                                style={{ color: 'var(--color-ink-muted)' }}
                              >
                                {msg.content}
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    {/* Entity description (non-channel) */}
                    <Show when={hoveredEntity()?.type !== 'channel' && hoveredEntity()?.description}>
                      <div
                        class="text-[0.625rem] mb-3 line-clamp-2"
                        style={{ color: 'var(--color-ink-muted)' }}
                      >
                        {hoveredEntity()?.description}
                      </div>
                    </Show>

                    {/* Divider */}
                    <div
                      class="h-[1px] mb-3"
                      style={{
                        background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} 60%, transparent 100%)`,
                        opacity: '0.4',
                      }}
                    />

                    {/* Action buttons row */}
                    <div class="flex items-start gap-3">
                      <ActionButton label="Done">
                        <Hotkey token={TOKENS.entity.action.markDone} class="flex gap-0.5" />
                      </ActionButton>
                      <ActionButton label="New tab">
                        <Hotkey shortcut="opt" class="flex gap-0.5" />
                        <span class="ml-0.5">Click</span>
                      </ActionButton>
                      <ActionButton label="Preview">
                        <Hotkey token={TOKENS.unifiedList.togglePreview} class="flex gap-0.5" />
                      </ActionButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </Portal>
  );
}
