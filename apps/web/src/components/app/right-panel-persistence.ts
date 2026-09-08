import { BlockAliasRegistry, BlockRegistry } from '@core/block';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { z } from 'zod';
import {
  createRightPanelState,
  type RightPanelSnapshot,
} from './right-panel-state';

const snapshotSchema = z.object({
  tabs: z.array(
    z.object({
      title: z.string(),
      content: z.object({
        type: z.enum([...BlockRegistry, ...BlockAliasRegistry]),
        id: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
        aliasContext: z
          .object({
            alias: z.enum(BlockAliasRegistry),
            baseType: z.enum(BlockRegistry),
          })
          .optional(),
        preserveParams: z.boolean().optional(),
      }),
    })
  ),
  active: z.string().optional(),
  expanded: z.boolean(),
});

function restore(raw: string | null): RightPanelSnapshot | undefined {
  if (!raw) return;
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    const tabs = parsed.data.tabs.map((tab) => ({
      ...tab,
      key: `${resolveBlockAlias(tab.content.type)}:${tab.content.id}`,
    }));
    return {
      tabs,
      active:
        tabs.find((tab) => tab.key === parsed.data.active)?.key ?? tabs[0]?.key,
      expanded: parsed.data.expanded && tabs.length > 0,
    };
  } catch {
    return;
  }
}

/** Each main item owns a user-scoped set of reference tabs across navigation and reloads. */
export function createRightPanelRegistry(userId?: string) {
  const states = new Map<string, ReturnType<typeof createRightPanelState>>();
  return {
    forContent(key: string) {
      const existing = states.get(key);
      if (existing) return existing;
      const storage = createUserScopedStorage(
        `macro:reference-tabs:v1:${encodeURIComponent(key)}`
      );
      const state = createRightPanelState({
        initial: restore(userId ? storage.read(userId) : null),
        onChange: (snapshot) => {
          if (!userId) return;
          storage.write(userId, JSON.stringify(snapshot));
        },
      });
      states.set(key, state);
      return state;
    },
  };
}
