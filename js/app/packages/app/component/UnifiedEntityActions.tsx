import type { EntityData } from '@macro-entity';
import { createSignal } from 'solid-js';

export type EntityActionType =
  | 'mark_as_done'
  | 'delete'
  | 'rename'
  | 'move_to_project'
  | 'copy';

export type EntityActionResult = {
  success: boolean;
  failedEntities?: EntityData[];
  message?: string;
};

export type EntityActionHandler = (
  entities: EntityData[]
) => Promise<EntityActionResult>;

export type EntityActionConfig = {
  label?: string;
  icon?: string;
  disabled?: (entity: EntityData) => boolean;
};

export type EntityActionRegistry = {
  register: (
    type: EntityActionType,
    handler: EntityActionHandler,
    config?: EntityActionConfig
  ) => void;
  getHandler: (type: EntityActionType) => EntityActionHandler | undefined;
  getConfig: (type: EntityActionType) => EntityActionConfig | undefined;
  execute: (
    type: EntityActionType,
    entities: EntityData | EntityData[]
  ) => Promise<EntityActionResult>;
  isActionDisabled: (
    type: EntityActionType,
    entities: EntityData | EntityData[]
  ) => boolean;
  getAvailableActions: () => EntityActionType[];
  has: (action: EntityActionType) => boolean;
};

/**
 * Creates a registry for entity actions that supports both individual and bulk operations
 */
export function createEntityActionRegistry(): EntityActionRegistry {
  const actions = new Map<EntityActionType, EntityActionHandler>();
  const configs = new Map<EntityActionType, EntityActionConfig>();

  const register = (
    type: EntityActionType,
    handler: EntityActionHandler,
    config?: EntityActionConfig
  ): void => {
    actions.set(type, handler);
    if (config) {
      configs.set(type, config);
    }
  };

  const getHandler = (
    type: EntityActionType
  ): EntityActionHandler | undefined => {
    return actions.get(type);
  };

  const getConfig = (
    type: EntityActionType
  ): EntityActionConfig | undefined => {
    return configs.get(type);
  };

  const execute = async (
    type: EntityActionType,
    entities: EntityData | EntityData[]
  ): Promise<EntityActionResult> => {
    const handler = actions.get(type);
    if (!handler) {
      return { success: false, message: `Unknown action: ${type}` };
    }

    const result = await handler(
      Array.isArray(entities) ? entities : [entities]
    );

    if (typeof result === 'boolean') {
      return { success: result };
    } else if (result && typeof result === 'object') {
      return result;
    }
    return { success: true };
  };

  const isActionDisabled = (
    type: EntityActionType,
    entities: EntityData | EntityData[]
  ): boolean => {
    const config = configs.get(type);
    if (!config) return false;
    if (Array.isArray(entities)) {
      return entities.some((e) => config.disabled?.(e));
    }
    return config.disabled?.(entities) ?? false;
  };

  const getAvailableActions = (): EntityActionType[] => {
    return Array.from(actions.keys());
  };

  return {
    register,
    getHandler,
    getConfig,
    execute,
    isActionDisabled,
    getAvailableActions,
    has: (action) => actions.has(action),
  };
}
