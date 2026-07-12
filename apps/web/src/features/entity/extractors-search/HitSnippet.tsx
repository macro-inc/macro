import { HighlightRender, windowSearchMatch } from '@core/util/searchHighlight';

interface HitSnippetProps {
  /** Highlight-tagged hit content (with `<macro_em>` tags). */
  content: string;
  /** Half-width character budget from useCharacterCount. */
  chars: number;
}

/**
 * Renders search hit content windowed around the highlight via
 * windowSearchMatch.
 */
export function HitSnippet(props: HitSnippetProps) {
  return (
    <HighlightRender text={windowSearchMatch(props.content, props.chars)} />
  );
}
