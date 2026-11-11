/** Model capabilities used by the shared emoji picker and shortcode resolver. */
export interface EmojiMenuHost {
  root(): HTMLElement | null;
  subscribeRoot(listener: () => void): () => void;
  /** Remove search first, then insert text at the actual current selection. */
  insertEmoji(text: string): void;
  closeSearch(): void;
  /** Source retains this transform for the editor lifetime. */
  registerSearchText(listener: (text: string) => void): void;
}
