import type { BlockName } from '@core/block';
import { mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
  PASTE_COMMAND,
} from 'lexical';
import { INSERT_DOCUMENT_MENTION_COMMAND } from '../mentions';

type MacroAppUrlParsed = {
  isValid: boolean;
  id: string | undefined;
  block: BlockName | undefined;
  params: Record<string, string> | undefined;
};
const Hosts = {
  Prod: 'macro.com',
  Dev: 'dev.macro.com',
  Staging: 'staging.macro.com',
  Localhost: 'localhost',
} as const;

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

    const validTypes: BlockName[] = [
      'chat',
      'write',
      'pdf',
      'md',
      'code',
      'image',
      'canvas',
      'channel',
      'project',
      'color',
    ];
    const _block: string = pathParts[1];
    if (!validTypes.includes(_block as any)) {
      return {
        isValid: false,
        id: undefined,
        block: undefined,
        params: undefined,
      };
    }
    const block: BlockName = _block as BlockName;

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
