export function isGithubBotLogin(login: string | null | undefined): boolean {
  return !!login?.endsWith('[bot]');
}

export function githubDisplayLogin(login: string): string {
  return login.replace(/\[bot\]$/, '');
}

export function githubAvatarUrl(login: string): string {
  return `https://github.com/${githubDisplayLogin(login)}.png?size=48`;
}
