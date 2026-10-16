import { screenToWorld } from '../../core/camera';
import type { GraphicsEditor } from '../../core/editor';
import type { Point } from '../../core/model';
import type { GraphicsPresence } from '../presence';

/** Browser-only cursor sampling for the collaborative wrapper. No editing handlers. */
export function attachPresencePointer(
  element: HTMLElement,
  editor: GraphicsEditor,
  presence: GraphicsPresence
) {
  let client: Point | null = null;
  const publish = () => {
    const rect = element.getBoundingClientRect();
    if (
      !client ||
      client.x < rect.left ||
      client.y < rect.top ||
      client.x > rect.right ||
      client.y > rect.bottom
    ) {
      presence.setCursor(null);
      return;
    }
    presence.setCursor(
      screenToWorld(editor.getCamera(), {
        x: client.x - rect.left,
        y: client.y - rect.top,
      })
    );
  };
  const pointer = (event: PointerEvent) => {
    client = { x: event.clientX, y: event.clientY };
    publish();
  };
  const leave = () => {
    client = null;
    presence.setCursor(null);
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') leave();
  };
  element.addEventListener('pointermove', pointer);
  element.addEventListener('pointerdown', pointer);
  element.addEventListener('pointerup', pointer);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', visibility);
  const unsubscribe = editor.subscribeCamera(publish);
  return () => {
    unsubscribe();
    element.removeEventListener('pointermove', pointer);
    element.removeEventListener('pointerdown', pointer);
    element.removeEventListener('pointerup', pointer);
    element.removeEventListener('pointerleave', leave);
    element.removeEventListener('pointercancel', leave);
    window.removeEventListener('blur', leave);
    document.removeEventListener('visibilitychange', visibility);
    leave();
  };
}
