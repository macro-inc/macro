/**
 * Global hover sound system
 * Detects hover events on elements with a `sound` attribute and plays sounds
 */

import { onCleanup, onMount } from 'solid-js';
import { playSound } from './sound';

let hoverListenerAttached = false;
let lastHoveredElement: Element | null = null;
let lastHoveredY: number | null = null;
let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize the global sound hover listener
 * Should be called once when the app mounts
 */
export function useSoundHover(): void {
  if (hoverListenerAttached) {
    return;
  }

  const handleMouseOver = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!target) return;

    // Find the closest element with a sound attribute
    const soundElement = target.closest('[sound]');

    if (!soundElement) {
      // Clear hover state if we moved away from a sound element
      if (lastHoveredElement) {
        lastHoveredElement = null;
        lastHoveredY = null;
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
      }
      return;
    }

    // If we're already hovering over this element, don't play again
    if (soundElement === lastHoveredElement) {
      return;
    }

    // Clear any pending timeout
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }

    // Get the sound name from the attribute
    const soundName = soundElement.getAttribute('sound');
    if (!soundName) return;

    // Determine sound based on vertical direction
    const currentY = event.clientY;
    let soundToPlay = soundName;

    if (lastHoveredY !== null && lastHoveredElement) {
      // Determine direction: if moving down (Y increases), play "down", if moving up (Y decreases), play "up"
      if (currentY > lastHoveredY) {
        soundToPlay = 'down';
      } else if (currentY < lastHoveredY) {
        soundToPlay = 'up';
      }
      // If Y is the same, use the original sound name
    }

    // Update last hovered element and position
    lastHoveredElement = soundElement;
    lastHoveredY = currentY;

    // Small debounce to prevent rapid playback when moving between child elements
    hoverTimeout = setTimeout(() => {
      playSound(soundToPlay);
      hoverTimeout = null;
    }, 50);
  };

  const handleMouseOut = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!target) return;

    // Check if we're leaving a sound element
    const soundElement = target.closest('[sound]');
    if (!soundElement && lastHoveredElement) {
      // Clear hover state
      lastHoveredElement = null;
      lastHoveredY = null;
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
    }
  };

  onMount(() => {
    hoverListenerAttached = true;
    document.addEventListener('mouseover', handleMouseOver, { passive: true });
    document.addEventListener('mouseout', handleMouseOut, { passive: true });
  });

  onCleanup(() => {
    hoverListenerAttached = false;
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    lastHoveredElement = null;
    lastHoveredY = null;
  });
}
