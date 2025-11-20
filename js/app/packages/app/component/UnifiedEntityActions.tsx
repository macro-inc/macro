import { type EntityData, isEntityData } from '@macro-entity';
import type { Component } from 'solid-js';

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
  /** Optional label for the action */
  label?: string;
  /** Optional icon component */
  icon?: Component;
  /**
   * Optional test to run over an entity to see if the action can be performed
   * on that entity.
   */
  testEnabled?: (entity: EntityData) => boolean;
  /**
   * Enabled mode for bulk version of action. If 'every' then all entities must pass
   * for the action to register as enabled. If 'some' then the action can be
   * enabled if a single entity passes the test. Only meaningful if testEnabled
   * is also provided. Default is 'every'
   */
  enabledMode?: 'some' | 'every';
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
  isActionEnabled: (
    type: EntityActionType,
    entities: EntityData | EntityData[]
  ) => boolean;
  getAvailableActions: () => EntityActionType[];
  has: (action: EntityActionType) => boolean;
};

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

  const isActionEnabled = (
    type: EntityActionType,
    entities: EntityData | EntityData[]
  ): boolean => {
    const { testEnabled, enabledMode } = configs.get(type) ?? {};
    if (!testEnabled) return true;
    if (Array.isArray(entities)) {
      if (enabledMode === 'some') {
        return entities.some(testEnabled);
      } else {
        return entities.every(testEnabled);
      }
    } else if (isEntityData(entities)) {
      return testEnabled(entities);
    }
    return false;
  };

  const getAvailableActions = (): EntityActionType[] => {
    return Array.from(actions.keys());
  };

  return {
    register,
    getHandler,
    getConfig,
    execute,
    isActionEnabled: isActionEnabled,
    getAvailableActions,
    has: (action) => actions.has(action),
  };
}
