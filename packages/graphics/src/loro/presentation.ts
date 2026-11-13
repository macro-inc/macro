import type { LoroDoc } from 'loro-crdt';
import {
  type SlideTransition,
  validSlideTransition,
} from '../core/slide-transition';

/**
 * Canvas-wide presentation settings, in a root map beside the scene. Each key
 * is one last-writer-wins JSON register, and clients that do not know the map
 * ignore it. An invalid stored value reads as absent.
 */
export type Presentation = Readonly<{
  /** Plays into every slide that has no transition of its own. */
  transition?: SlideTransition;
}>;
export type PresentationEdit = Readonly<{
  /** Null removes the deck default, so slides without their own cut. */
  transition: SlideTransition | null;
}>;

const ROOT = 'presentation';

export function readPresentation(doc: LoroDoc): Presentation {
  const transition: unknown = doc.getMap(ROOT).get('transition');

  return validSlideTransition(transition) ? { transition } : {};
}

/** Stages the edit on the document's open transaction; the caller commits. */
export function applyPresentationEdit(doc: LoroDoc, edit: PresentationEdit) {
  if (edit.transition && !validSlideTransition(edit.transition))
    throw new Error('Invalid slide transition');

  const settings = doc.getMap(ROOT);
  if (edit.transition === null) settings.delete('transition');
  else settings.set('transition', { ...edit.transition });
}

export function subscribePresentation(doc: LoroDoc, listener: () => void) {
  return doc.getMap(ROOT).subscribe(listener);
}
