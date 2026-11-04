import type { ParentProps } from 'solid-js';
// Shell service boundaries; SidePanel, record chrome and all changed controls are production components.
export const useMaybeBlockAliasedName = () => undefined;
export const useSplitPanel = () => undefined;
export const registerHotkey = () => () => {};
export const SplitHeaderRight = (props: ParentProps) => props.children;
export const OwnerLabel = () => null;

export const blockAcceptedFileExtensionSet = new Set();
export const fileTypeToBlockName = () => 'unknown';
export const isBlockAlias = () => false;
export const itemToBlockName = () => 'unknown';
