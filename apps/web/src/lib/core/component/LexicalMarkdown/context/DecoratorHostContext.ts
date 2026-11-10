import { createContext } from 'solid-js';

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

export const DecoratorHostContext = createContext<DecoratorHost>();
