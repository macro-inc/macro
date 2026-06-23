import {
  type BlockAlias,
  BlockAliasRegistry,
  type BlockName,
  BlockRegistry,
} from '@core/block';
import { isTauri } from '@core/util/platform';
import { mergeRegister } from '@lexical/utils';
import { parseThemeV2Json } from '@theme/utils/themeValidation';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';
import {
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_PR_MENTION_COMMAND,
  INSERT_THEME_MENTION_COMMAND,
} from '../mentions';

type MacroAppUrlParsed = {
  isValid: boolean;
  id: string | undefined;
  block: BlockName | BlockAlias | undefined;
  params: Record<string, string> | undefined;
};

const Hosts = {
  Prod: 'macro.com',
  Dev: 'dev.macro.com',
  Localhost: 'localhost',
} as const;

const IgnoredParams = new Set(['referral_code']);

const ValidBlockNames = [...BlockRegistry, ...BlockAliasRegistry];

function cleanHostname(hostname: string): string {
  return hostname.replace('www.', '').toLowerCase();
}

function isValidMentionHostname(hostname: string): boolean {
  const current = cleanHostname(window.location.hostname);
  const target = cleanHostname(hostname);
  if (current === target) {
    return true;
  }
  if (
    (target === Hosts.Dev && current === Hosts.Localhost) ||
    (target === Hosts.Localhost && current === Hosts.Dev)
  ) {
    return true;
  }
  // On Tauri, window.location.hostname is 'localhost', but Macro links are
  // built with the real web origin (macro.com or dev.macro.com). Accept any
  // recognized Macro host when running inside the native Tauri app.
  if (isTauri() && current === Hosts.Localhost) {
    return target === Hosts.Prod || target === Hosts.Dev;
  }
  return false;
}

export function parseMacroAppUrl(text: string): MacroAppUrlParsed {
  try {
    const url: URL = new URL(text);
    if (
      !url.pathname.startsWith('/app/') ||
      !isValidMentionHostname(url.hostname)
    ) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }

    const pathParts: string[] = url.pathname.split('/').filter((part) => part);
    if (pathParts.length < 3) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }

    const _block: string = pathParts[1];
    if (!ValidBlockNames.includes(_block as any)) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }
    const block: BlockName | BlockAlias = _block as BlockName | BlockAlias;

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

function registerTextPastePlugin(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event: InputEvent | ClipboardEvent) => {
        if (event instanceof ClipboardEvent) {
          const pastedText: string =
            event.clipboardData?.getData('text/plain') || '';

          // Check for theme JSON before checking for Macro URL
          const themeV2 = parseThemeV2Json(pastedText);
          if (themeV2) {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && !selection.isCollapsed())
              return false;

            event.preventDefault();
            editor.dispatchCommand(INSERT_THEME_MENTION_COMMAND, {
              name: themeV2.name,
              data: themeV2,
            });
            return true;
          }

          const parsedMacroAppUrl = parseMacroAppUrl(pastedText);
          if (
            !parsedMacroAppUrl.isValid ||
            !parsedMacroAppUrl.id ||
            !parsedMacroAppUrl.block
          ) {
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

export function textPastePlugin() {
  return (editor: LexicalEditor) => registerTextPastePlugin(editor);
}
