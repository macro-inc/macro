import { createContext } from 'solid-js';
import type { SnapshotHost } from '../decorator-host/snapshot-host';

export interface DecoratorUploadCallbacks {
  start(): void;
  success(): void;
  failure(): void;
}

/** Editor capabilities used by shared decorator components, without model handles. */
export interface DecoratorHost {
  isSelected(key: string): boolean;
  isEditable(): boolean;
  isInteractable(): boolean;
  updateUserDisplayName(userId: string, displayName: string): void;
  readonly horizontalRule: {
    select(key: string): void;
    remove(key: string): void;
  };
  readonly diffInsert: {
    /**
     * The parent diff's raw user id, read once like the Source memo; null when
     * the node is missing or has no diff parent.
     */
    owner(key: string): { readonly userId: string | undefined } | null;
  };
  readonly equation: {
    requestEdit(key: string): void;
    current(key: string): { equation: string; inline: boolean } | null;
    element(key: string): HTMLElement | null;
    registerMenu(callbacks: { edit(key: string): void; create(): void }): void;
    update(key: string, equation: string): void;
    insert?(equation: string, inline: boolean): void;
    root(): HTMLElement | null;
    focus(): void;
  };
  readonly image: {
    select(key: string): void;
    remove(key: string): void;
    resize(key: string, width: number, height: number): void;
    persistScale(key: string, scale: number): void;
    readScale(key: string, fallback: number): number | undefined;
    upgradeUrl(key: string, url: string): void;
    subscribeUploads(
      key: string,
      callbacks: DecoratorUploadCallbacks
    ): () => void;
    mounted(key: string): void;
  };
}

/** Capabilities used by the shared horizontal-rule component. */
export type HorizontalRuleHost = Pick<
  DecoratorHost,
  'isSelected' | 'isEditable' | 'horizontalRule'
>;

/** A decorator group supplies its actual capabilities; consumers must request an implemented host. */
export type DecoratorHostCapabilities = Partial<DecoratorHost> & {
  readonly snapshot?: SnapshotHost;
};

export const DecoratorHostContext = createContext<DecoratorHostCapabilities>();
