import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';

const initialized = new WeakSet<SplitHandle>();

/** Retain the live Soup state when returning from an inner preview. */
export function shouldInitializeList(handle: SplitHandle) {
  if (!handlers.has(handle)) return true;
  if (initialized.has(handle)) return false;
  initialized.add(handle);
  return true;
}

const handlers = new WeakMap<SplitHandle, (entity: EntityData) => void>();

/** Register a workspace's inner content as the destination for ordinary opens. */
export function registerListPreview(
  handle: SplitHandle,
  open: (entity: EntityData) => void
) {
  handlers.set(handle, open);
  return () => {
    if (handlers.get(handle) === open) {
      handlers.delete(handle);
      initialized.delete(handle);
    }
  };
}

export function openListPreview(
  entity: EntityData,
  options: {
    splitHandle?: SplitHandle;
    openInNewSplit?: boolean;
    replacePreview?: boolean;
  }
): boolean {
  if (
    !options.splitHandle ||
    options.openInNewSplit ||
    options.replacePreview ||
    options.splitHandle.isControllerSplit()
  )
    return false;
  // Folder navigation and special external entities retain their existing routing.
  if (
    !['email', 'document', 'chat', 'crm_company', 'crm_contact'].includes(
      entity.type
    )
  )
    return false;
  const open = handlers.get(options.splitHandle);
  if (!open) return false;
  open(entity);
  return true;
}
