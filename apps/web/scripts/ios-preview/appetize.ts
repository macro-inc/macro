/**
 * Shared pieces of the Appetize iOS preview: the PR comment's identity marker,
 * the device links it offers, and recovery of the Appetize public key from a
 * previously posted comment.
 *
 * The comment is the only store of the key — the same trick
 * `scripts/preview/get-or-create-id.ts` uses for web preview ids, so a PR keeps
 * one Appetize app across pushes and the cleanup job can find it on close.
 */

export const IOS_PREVIEW_MARKER = '<!-- appetize-ios-preview -->';

export interface PreviewDevice {
  /** Appetize `device` query-parameter slug. */
  slug: string;
  label: string;
}

/**
 * Sizes offered in the comment. `device` is a query parameter over one uploaded
 * build, so every extra entry here is free — no rebuild, no second upload.
 */
export const PREVIEW_DEVICES: readonly PreviewDevice[] = [
  { slug: 'iphone15pro', label: 'iPhone 15 Pro' },
  { slug: 'iphone16promax', label: 'iPhone 16 Pro Max' },
  { slug: 'ipadpro129inch5thgeneration', label: 'iPad Pro 12.9"' },
];

export const APPETIZE_KEY_REGEX = /appetize\.io\/app\/([a-z0-9_-]+)/i;

/**
 * `autoplay=false` is already Appetize's default, but it is the whole reason
 * these links cost nothing until someone clicks, so it is set explicitly.
 *
 * `osVersion` is deliberately absent: Appetize recommends omitting it so embeds
 * track the current default rather than breaking when a runtime is retired.
 */
export function buildEmbedUrl(publicKey: string, deviceSlug: string): string {
  const parameters = new URLSearchParams({
    device: deviceSlug,
    autoplay: 'false',
  });
  return `https://appetize.io/app/${publicKey}?${parameters}`;
}

export interface CommentBodyInput {
  publicKey: string;
  branchName: string;
  commitSha: string;
  devices?: readonly PreviewDevice[];
}

export function buildIosCommentBody({
  publicKey,
  branchName,
  commitSha,
  devices = PREVIEW_DEVICES,
}: CommentBodyInput): string {
  const links = devices
    .map((device) => `[${device.label}](${buildEmbedUrl(publicKey, device.slug)})`)
    .join(' · ');

  return [
    IOS_PREVIEW_MARKER,
    `**iOS preview** — \`${branchName}\` @ \`${commitSha.slice(0, 7)}\``,
    '',
    links,
    '',
    'Boots on click; nothing streams until then. You will need to sign in inside the simulator.',
  ].join('\n');
}

export function extractPublicKeyFromBody(body: string): string | null {
  return body.match(APPETIZE_KEY_REGEX)?.[1] ?? null;
}

export interface IssueComment {
  id: number;
  body?: string;
  user?: { type?: string };
}

/**
 * Our comment, never the web preview's. Both are posted by the same bot, so the
 * marker is the only thing separating them — and appending to the web preview's
 * comment would break the preview-id regex that reads it back.
 */
export function findIosPreviewComment(
  comments: readonly IssueComment[]
): IssueComment | null {
  return (
    comments.find(
      (comment) =>
        comment.body?.includes(IOS_PREVIEW_MARKER) &&
        comment.user?.type === 'Bot'
    ) ?? null
  );
}
