import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

// blockId -> showFrontMatter
type FrontMatterPreference = Record<string, boolean>;

const [frontMatterPreference_, setFrontMatterPreference] = makePersisted(
  createStore<FrontMatterPreference>({}),
  {
    name: 'mdFrontMatterPreference',
    storage: localStorage,
  }
);

export const frontMatterPreference = frontMatterPreference_;

export const getFrontMatterPreference = (documentId: string): boolean => {
  // Default to true if not set
  if (frontMatterPreference_[documentId] === undefined) {
    return true;
  }
  return frontMatterPreference_[documentId];
};

export const setFrontMatterPreferenceForDoc = (
  documentId: string,
  value: boolean
) => {
  setFrontMatterPreference(documentId, value);
};
