import { useOptionalSplitRouter } from '@app/lib/split-router';
import {
  createMacroMentionLinkResolver,
  type MacroMentionLinkResolver,
} from './mention-links';

/** Capture an app-owned resolver at an editor host, then pass it to the editor. */
export function useMacroMentionLinkResolver():
  | MacroMentionLinkResolver
  | undefined {
  const router = useOptionalSplitRouter();
  return router && createMacroMentionLinkResolver(router.routes);
}
