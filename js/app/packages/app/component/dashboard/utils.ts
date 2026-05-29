import {
  createTheme,
  theme as markdownTheme,
} from '@core/component/LexicalMarkdown/theme';

export const compactMarkdownTheme = createTheme(
  {
    paragraph: 'm-0 text-[1em] leading-5',
    list: {
      listitem: 'm-0 leading-5',
    },
  },
  markdownTheme
);

export function channelDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim().replace(/^#+/, '').trim();
  return trimmed || 'Untitled channel';
}

export function channelInitials(name: string) {
  const letters = channelDisplayName(name)
    .replace(/[,_./\\-]+/g, ' ')
    .split(/\s+/)
    .flatMap((part) => part.match(/[a-zA-Z0-9]/)?.[0] ?? [])
    .slice(0, 2)
    .map((letter) => letter.toUpperCase());

  return letters.join('') || '?';
}
