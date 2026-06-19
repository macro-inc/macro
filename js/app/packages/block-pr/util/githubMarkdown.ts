export function isGithubBotLogin(login: string | null | undefined): boolean {
  return !!login?.endsWith('[bot]');
}

export function githubDisplayLogin(login: string): string {
  return login.replace(/\[bot\]$/, '');
}

export function githubAvatarUrl(login: string): string {
  return `https://github.com/${githubDisplayLogin(login)}.png?size=48`;
}

/**
 * GitHub comment bodies — especially from bots like CodeRabbit — are littered
 * with HTML that our markdown renderer shows literally: marker comments
 * (`<!-- ... -->`), collapsible `<details>/<summary>` wrappers, `<sub>` fine
 * print. Strip the tags but keep the human-readable content.
 */
export function cleanGithubMarkdown(body: string): string {
  return (
    body
      // Marker/annotation comments carry no content.
      .replace(/<!--[\s\S]*?-->/g, '')
      // Collapsible sections: promote the summary line, drop the wrappers.
      .replace(/<summary>([\s\S]*?)<\/summary>/gi, '**$1**\n\n')
      .replace(/<\/?details[^>]*>/gi, '')
      // CodeRabbit's decorative SVG badges are inline image markdown. Our image
      // transformer only handles image-only blocks, so render these as normal
      // text links instead of a stray "!" plus a giant URL.
      .replace(
        /!\[([^\]]*)\]\((https?:\/\/storage\.googleapis\.com\/coderabbit_public_assets\/[^)\s]+)(?:\s"[^"]*")?\)/g,
        '[$1]($2)'
      )
      // Inline formatting tags whose content should stay.
      .replace(/<\/?(?:sub|sup|b|i|em|strong|kbd)>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // Collapse the blank-line runs left behind by removals.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
