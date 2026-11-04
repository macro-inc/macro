const QUICK_START = `npm install @macro-inc/sdk
export MACRO_API_KEY="<your token>"`;

const PROFILE_SNIPPET = `const macro = new Macro({});
const image = await macro.me.uploadProfilePicture(bytes, {
  fileName: 'avatar.png',
  contentType: 'image/png',
});
await macro.me.update({ name: 'Your Name', profilePicture: image });`;

const NEW_TOKEN_SNIPPET = `const { secret } = await macro.apiKeys.create('my token');`;

const PRODUCT_DOCS_URL = 'https://docs.macro.com';
const SDK_DOCS_URL = 'https://sdk.macro.com';

/** The page's wording, translated where it renders. */
export type AgentSetupCopy = {
  title: string;
  intro: string;
  teamJoinFailed: string;
  tokenLabel: string;
  useToken: string;
  docsHeading: string;
  productDocs: string;
  sdkDocs: string;
  setProfile: string;
  anotherToken: string;
  anotherTokenSettings: string;
  openApp: string;
  openAppLink: string;
};

function codeBlock(code: string, language: string) {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/** An agent's first page: its SDK token and what to do with it. */
export function agentSetupMarkdown(input: {
  copy: AgentSetupCopy;
  apiKey: string;
  teamJoinFailed: boolean;
  /** Confirms the token was saved and opens the app. */
  openAppUrl: string;
}) {
  const { copy, apiKey, teamJoinFailed, openAppUrl } = input;

  return [
    `# ${copy.title}`,
    copy.intro,
    ...(teamJoinFailed ? [`> ${copy.teamJoinFailed}`] : []),
    `## ${copy.tokenLabel}`,
    codeBlock(apiKey, 'text'),
    `## ${copy.useToken}`,
    codeBlock(QUICK_START, 'sh'),
    `## ${copy.setProfile}`,
    codeBlock(PROFILE_SNIPPET, 'ts'),
    `## ${copy.anotherToken}`,
    codeBlock(NEW_TOKEN_SNIPPET, 'ts'),
    copy.anotherTokenSettings,
    `## ${copy.docsHeading}`,
    `- [${copy.productDocs}](${PRODUCT_DOCS_URL})\n- [${copy.sdkDocs}](${SDK_DOCS_URL})`,
    `## ${copy.openApp}`,
    `[${copy.openAppLink}](${openAppUrl})`,
  ].join('\n\n');
}

export type MarkdownPart =
  | { t: 'text'; text: string }
  | { t: 'link'; label: string; url: string };

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Finds the links in markdown source so they can stay clickable as source. */
export function markdownParts(markdown: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  let end = 0;

  for (const link of markdown.matchAll(MARKDOWN_LINK)) {
    if (link.index > end) {
      parts.push({ t: 'text', text: markdown.slice(end, link.index) });
    }
    parts.push({ t: 'link', label: link[1] ?? '', url: link[2] ?? '' });
    end = link.index + link[0].length;
  }

  if (end < markdown.length) {
    parts.push({ t: 'text', text: markdown.slice(end) });
  }

  return parts;
}
