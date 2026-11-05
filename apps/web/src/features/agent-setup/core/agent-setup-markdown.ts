const QUICK_START = `npm install @macro-inc/sdk
export MACRO_API_KEY="<your token>"`;

const PROFILE_SNIPPET = `const macro = new Macro({});
const image = await macro.me.uploadProfilePicture(bytes, {
  fileName: 'avatar.png',
  contentType: 'image/png',
});
await macro.me.update({ name: 'Your Name', profilePicture: image });`;

const NEW_TOKEN_SNIPPET = `const { secret } = await macro.apiKeys.create('my token');`;

const MACROD_INSTALL = `curl -fsSL https://raw.githubusercontent.com/macro-inc/macro/main/crates/coding_agent_worker/install/install.sh | sh
~/.local/bin/macrod detect-agents`;

const MACROD_START = `mkdir -p ~/.macrod && chmod 700 ~/.macrod
tmux kill-session -t macrod-agent 2>/dev/null
: > ~/.macrod/agent.log
tmux new-session -d -s macrod-agent '~/.local/bin/macrod service --config ~/.macrod/agent.toml --agent <agent id> --workspace "<absolute path>" >> ~/.macrod/agent.log 2>&1'`;

const MACROD_PAIRING_CODE = `grep '"event":"pairing"' ~/.macrod/agent.log`;

const MACROD_APPROVE = `await macro.harnesses.pairing('<code>').approve();`;

const PRODUCT_DOCS_URL = 'https://docs.macro.com';
const SDK_DOCS_URL = 'https://sdk.macro.com';
const MACROD_DOCS_URL = 'https://docs.macro.com/AI/bring-your-own';
const MACROD_SOURCE_URL =
  'https://github.com/macro-inc/macro/tree/main/crates/coding_agent_worker';

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
  macrod: string;
  macrodInstall: string;
  macrodStart: string;
  macrodApprove: string;
  macrodNext: string;
  macrodDocs: string;
  macrodSource: string;
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
    `## ${copy.macrod}`,
    copy.macrodInstall,
    codeBlock(MACROD_INSTALL, 'sh'),
    copy.macrodStart,
    codeBlock(MACROD_START, 'sh'),
    copy.macrodApprove,
    codeBlock(MACROD_PAIRING_CODE, 'sh'),
    codeBlock(MACROD_APPROVE, 'ts'),
    copy.macrodNext,
    `- [${copy.macrodDocs}](${MACROD_DOCS_URL})\n- [${copy.macrodSource}](${MACROD_SOURCE_URL})`,
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
