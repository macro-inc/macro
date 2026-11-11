import type {
  AutoLinkMatchMode,
  ILinkInfo,
} from '../../plugins/links/linksPlugin';

export interface LinkMenuCallbacks {
  hover(info?: ILinkInfo): void;
  click(info?: ILinkInfo): void;
  create(info?: ILinkInfo): void;
}

/** Model capabilities used by the floating link controller and its shared UI. */
export interface LinkMenuHost {
  isEditable(): boolean;
  isInteractable(): boolean;
  root(): HTMLElement | null;
  focus(): void;
  registerMenu(
    callbacks: LinkMenuCallbacks,
    autoLinkMatchMode?: AutoLinkMatchMode
  ): void;
  registerKeys(callbacks: { escape(): boolean; enter(): boolean }): () => void;
  insert(url: string, label: string): void;
  update(url: string, label: string): void;
  updateUrl(url: string | null): void;
  unlink(): void;
}
