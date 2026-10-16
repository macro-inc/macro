import {
  type PrRef,
  prDisplayName,
  prHtmlUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import {
  type BlockAlias,
  BlockAliasRegistry,
  type BlockName,
  BlockRegistry,
} from '@core/block';
import { isValidMacroAppHostname } from '@core/util/macroAppUrl';
import { $isCodeNode } from '@lexical/code';
import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $createBookingLinkMentionNode,
  $createPasteNode,
  $createPullRequestMentionNode,
  $isCustomCodeNode,
  BookingLinkMentionNode,
  HISTORY_MERGE_TAG,
  isMacroBookingUrl,
  PasteNode,
  PullRequestMentionNode,
  parseBookingUrl,
} from '@macro-inc/lexical-core';
import {
  fetchPullRequestByGithubKey,
  getCachedPullRequestByGithubKey,
} from '@queries/storage/pr-mention';
import { convertThemev2v3 } from '@theme/utils/themeMigrations';
import {
  parseThemeV2Json,
  parseThemeV3Json,
} from '@theme/utils/themeValidation';
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';
import { $insertNodesAndSplitList } from '../../utils';
import {
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_PR_MENTION_COMMAND,
  INSERT_THEME_MENTION_COMMAND,
} from '../mentions';

/**
 * Character threshold above which a plain-text paste collapses into a
 * block-level PasteNode (mirroring Anthropic's "pasted" chip) instead of
 * being inserted inline. Chosen to roughly match a few paragraphs of prose.
 */
export const LARGE_PASTE_CHAR_THRESHOLD = 1500;

type MacroAppUrlParsed = {
  isValid: boolean;
  id: string | undefined;
  block: BlockName | BlockAlias | undefined;
  params: Record<string, string> | undefined;
};
export type MentionLinkResolver = (url: string) =>
  | {
      id: string;
      block: BlockName | BlockAlias;
      params: Record<string, string>;
    }
  | undefined;

const IgnoredParams = new Set(['referral_code']);

const ValidBlockNames = [...BlockRegistry, ...BlockAliasRegistry];

export function parseMacroAppUrl(text: string): MacroAppUrlParsed {
  try {
    const url: URL = new URL(text);
    if (
      !url.pathname.startsWith('/app/') ||
      !isValidMacroAppHostname(url.hostname)
    ) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }

    const pathParts: string[] = url.pathname.split('/').filter((part) => part);
    if (pathParts.length !== 3) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }

    const routeBlock = pathParts[1] === 'agents' ? 'agent' : pathParts[1];
    const block = ValidBlockNames.find((name) => name === routeBlock);
    if (!block) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }

    const idRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!idRegex.test(pathParts[2])) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }

    const id: string = pathParts[2];
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      if (IgnoredParams.has(key)) return;
      params[key] = value;
    });

    return {
      isValid: true,
      id: id,
      block: block,
      params: params,
    };
  } catch {
    return {
      isValid: false,
      id: undefined,
      block: undefined,
      params: undefined,
    };
  }
}

export function resolvePastedMacroAppUrl(
  text: string,
  resolveAppLink?: MentionLinkResolver
) {
  const legacy = parseMacroAppUrl(text);
  return legacy.isValid ? legacy : resolveAppLink?.(text);
}

const GITHUB_HOSTNAMES = new Set(['github.com', 'www.github.com']);
const GITHUB_PR_PATH_PATTERN =
  /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)(?:\/.*)?$/;

/**
 * Parse a pasted github.com pull request URL, including its subpages such as
 * `/files`. Text with anything besides the URL is not a PR link paste.
 */
export function parsePastedGithubPrUrl(text: string): PrRef | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!GITHUB_HOSTNAMES.has(url.hostname)) return null;

  const match = url.pathname.match(GITHUB_PR_PATH_PATTERN);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function $isSelectionInCode(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  return (
    $findMatchingParent(
      selection.anchor.getNode(),
      (node) => $isCodeNode(node) || $isCustomCodeNode(node)
    ) !== null
  );
}

/**
 * Insert a pasted GitHub pull request URL as a PR mention. A PR already in the
 * cache becomes a mention immediately; otherwise the URL is inserted as a link
 * and upgraded once the lookup finds a synced PR. PRs Macro has not synced
 * stay links.
 */
function $insertPastedGithubPullRequest(
  editor: LexicalEditor,
  url: string,
  ref: PrRef
) {
  const githubKey = toGithubKey(ref);
  const label = prDisplayName(ref);
  // The canonical URL, not a pasted subpage, so agents reading the mention
  // get the pull request itself.
  const prUrl = prHtmlUrl(ref);

  const cached = getCachedPullRequestByGithubKey(githubKey);
  if (cached) {
    editor.dispatchCommand(INSERT_PR_MENTION_COMMAND, {
      id: cached.id,
      label,
      url: prUrl,
    });
    return;
  }

  const placeholder = editor.hasNode(LinkNode)
    ? $createLinkNode(url).append($createTextNode(url))
    : $createTextNode(url);
  $insertNodes([placeholder]);
  const placeholderKey = placeholder.getKey();

  void fetchPullRequestByGithubKey(githubKey).then((entity) => {
    if (!entity) return;
    editor.update(
      () => {
        const node = $getNodeByKey(placeholderKey);
        if (!node || !node.isAttached() || node.getTextContent() !== url) {
          return;
        }
        if ($isLinkNode(node) && node.getURL() !== url) return;

        const selection = $getSelection();
        const caretInPlaceholder =
          $isRangeSelection(selection) &&
          selection.isCollapsed() &&
          (selection.anchor.key === placeholderKey ||
            node.isParentOf(selection.anchor.getNode()));

        const mention = $createPullRequestMentionNode({
          id: entity.id,
          label,
          url: prUrl,
        });
        node.replace(mention);
        if (caretInPlaceholder) mention.selectEnd();
      },
      { tag: HISTORY_MERGE_TAG }
    );
  });
}

function registerTextPastePlugin(
  editor: LexicalEditor,
  resolveAppLink?: MentionLinkResolver
) {
  return mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event: InputEvent | ClipboardEvent) => {
        if (event instanceof ClipboardEvent) {
          const pastedText: string =
            event.clipboardData?.getData('text/plain') || '';

          // Check for theme JSON before checking for Macro URL
          const themeV3 =
            parseThemeV3Json(pastedText) ??
            (() => {
              const legacy = parseThemeV2Json(pastedText);
              return legacy ? convertThemev2v3(legacy) : null;
            })();
          if (themeV3) {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && !selection.isCollapsed())
              return false;

            event.preventDefault();
            editor.dispatchCommand(INSERT_THEME_MENTION_COMMAND, {
              name: themeV3.name,
              data: themeV3,
            });
            return true;
          }

          const githubPr = parsePastedGithubPrUrl(pastedText);
          if (githubPr && editor.hasNode(PullRequestMentionNode)) {
            const selection = $getSelection();
            if (
              !$isRangeSelection(selection) ||
              !selection.isCollapsed() ||
              $isSelectionInCode()
            ) {
              return false;
            }

            event.preventDefault();
            $insertPastedGithubPullRequest(editor, pastedText.trim(), githubPr);
            return true;
          }

          const trimmedPaste = pastedText.trim();
          if (
            isMacroBookingUrl(trimmedPaste) &&
            editor.hasNode(BookingLinkMentionNode)
          ) {
            const selection = $getSelection();
            if (
              !$isRangeSelection(selection) ||
              !selection.isCollapsed() ||
              $isSelectionInCode()
            ) {
              return false;
            }

            const parsed = parseBookingUrl(trimmedPaste);
            if (parsed) {
              event.preventDefault();
              const mention = $createBookingLinkMentionNode({
                profileId: parsed.profileId,
                slug: parsed.slug,
                label: parsed.slug,
                url: trimmedPaste,
              });
              $insertNodes([mention]);
              return true;
            }
          }

          const parsedMacroAppUrl = resolvePastedMacroAppUrl(
            pastedText,
            resolveAppLink
          );
          if (!parsedMacroAppUrl?.id || !parsedMacroAppUrl.block) {
            // Large plain-text pastes collapse into a block-level PasteNode
            // (Anthropic-style "pasted" chip). Only handle genuine plain text
            // pastes: defer to the richer paste handlers for HTML / Lexical
            // clipboards, and only when the cursor is a collapsed selection.
            const clipboard = event.clipboardData;
            const isRichClipboard = Boolean(
              clipboard?.getData('application/x-lexical-editor') ||
                clipboard?.getData('text/html')
            );
            if (
              !isRichClipboard &&
              editor.hasNode(PasteNode) &&
              pastedText.length > LARGE_PASTE_CHAR_THRESHOLD
            ) {
              const selection = $getSelection();
              if ($isRangeSelection(selection) && !selection.isCollapsed()) {
                return false;
              }
              event.preventDefault();
              $insertNodesAndSplitList([
                $createPasteNode({ content: pastedText }),
              ]);
              return true;
            }
            return false;
          }

          const selection = $getSelection();
          if ($isRangeSelection(selection) && !selection.isCollapsed())
            return false;

          event.preventDefault();
          if (parsedMacroAppUrl.block === 'pr') {
            editor.dispatchCommand(INSERT_PR_MENTION_COMMAND, {
              id: parsedMacroAppUrl.id,
            });
            return true;
          }

          editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
            documentId: parsedMacroAppUrl.id,
            documentName: '',
            blockName: parsedMacroAppUrl.block,
            blockParams: parsedMacroAppUrl.params || {},
          });
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    )
  );
}

export function textPastePlugin(resolveAppLink?: MentionLinkResolver) {
  return (editor: LexicalEditor) =>
    registerTextPastePlugin(editor, resolveAppLink);
}
