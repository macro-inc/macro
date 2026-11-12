import { usePreference } from '@app/lib/preferences/use-preference';

/**
 * Whether markdown documents fill the width of their pane instead of the
 * standard reading column. It is the reader's preference, not the document's:
 * it applies to every document this person opens and changes nothing for
 * collaborators. One module-level signal keeps documents open side by side in
 * split panes in step when it is toggled.
 */
export const [markdownWideMode, setMarkdownWideMode] = usePreference(
  'macro:pref:markdown:wide-mode',
  { default: false }
);
