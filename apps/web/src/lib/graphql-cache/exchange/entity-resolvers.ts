import {
  entityResolverSchema,
  type GeneratedEntityResolverArgumentPath,
  type GeneratedEntityResolverSchema,
  type GeneratedEntityResolverTarget,
} from '../generated/entity-resolver-schema';

/** Serializable declaration for a singular entity relation derived from an argument. */
export type EntityFromArgumentDescriptor<
  TargetType extends string,
  ArgumentPath extends readonly string[],
> = {
  readonly kind: 'entity-from-argument';
  readonly targetType: TargetType;
  readonly argumentPath: ArgumentPath;
};

/**
 * Declares that a field resolves to a normalized entity whose id is found at
 * `argumentPath`. The descriptor and a copied path are frozen so exchange
 * options remain immutable after construction.
 */
export function entityFromArgument<
  const TargetType extends GeneratedEntityResolverTarget,
  const ArgumentPath extends GeneratedEntityResolverArgumentPath,
>(
  targetType: TargetType,
  argumentPath: ArgumentPath
): EntityFromArgumentDescriptor<TargetType, ArgumentPath> {
  const copiedPath = Object.freeze([
    ...argumentPath,
  ]) as unknown as ArgumentPath;
  return Object.freeze({
    kind: 'entity-from-argument',
    targetType,
    argumentPath: copiedPath,
  });
}

type TargetFor<
  Parent extends keyof GeneratedEntityResolverSchema,
  Field extends keyof GeneratedEntityResolverSchema[Parent],
> = GeneratedEntityResolverSchema[Parent][Field] extends {
  readonly targets: readonly (infer Target extends string)[];
}
  ? Target
  : never;

type ArgumentPathFor<
  Parent extends keyof GeneratedEntityResolverSchema,
  Field extends keyof GeneratedEntityResolverSchema[Parent],
> = GeneratedEntityResolverSchema[Parent][Field] extends {
  readonly argumentPaths: readonly (infer Path extends readonly string[])[];
}
  ? Path
  : never;

/**
 * Schema-exact entity resolver configuration. TypeScript's `any` and unsafe
 * assertions can bypass these checks; exchange construction also validates
 * every descriptor at runtime.
 */
export type EntityResolverConfig = {
  [Parent in keyof GeneratedEntityResolverSchema]?: {
    [Field in keyof GeneratedEntityResolverSchema[Parent]]?: EntityFromArgumentDescriptor<
      TargetFor<Parent, Field>,
      ArgumentPathFor<Parent, Field>
    >;
  };
};

/** Transport descriptor consumed by browser/WASM and Tauri cache reads. */
export type EntityResolverWire = {
  parentType: string;
  fieldName: string;
  targetType: string;
  argumentPath: string[];
};

const EMPTY_ENTITY_RESOLVERS: readonly EntityResolverWire[] = Object.freeze([]);

function configError(detail: string): Error {
  return new Error(
    `invalid normalized cache entity resolver config: ${detail}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathMatches(
  candidate: readonly string[],
  expected: readonly (readonly string[])[]
): boolean {
  return expected.some(
    (path) =>
      path.length === candidate.length &&
      path.every((part, index) => part === candidate[index])
  );
}

/**
 * Validates and compiles user configuration once into a stable read wire.
 * Exported for focused runtime tests; callers normally use the exchange.
 */
export function compileEntityResolvers(
  config?: EntityResolverConfig
): readonly EntityResolverWire[] {
  if (config === undefined) return EMPTY_ENTITY_RESOLVERS;
  if (!isRecord(config)) throw configError('configuration must be an object');

  const runtimeSchema = entityResolverSchema as Record<
    string,
    Record<
      string,
      {
        readonly targets: readonly string[];
        readonly argumentPaths: readonly (readonly string[])[];
      }
    >
  >;
  const configRecord = config as Record<string, unknown>;
  const compiled: EntityResolverWire[] = [];
  for (const parentType of Object.keys(configRecord).sort()) {
    if (!Object.hasOwn(runtimeSchema, parentType)) {
      throw configError(`unknown parent type ${JSON.stringify(parentType)}`);
    }
    const parentSchema = runtimeSchema[parentType];
    if (!parentSchema) throw configError(`missing schema for ${parentType}`);
    const parentConfig = configRecord[parentType];
    if (!isRecord(parentConfig)) {
      throw configError(`${parentType} must map fields to descriptors`);
    }

    for (const fieldName of Object.keys(parentConfig).sort()) {
      if (!Object.hasOwn(parentSchema, fieldName)) {
        throw configError(
          `unknown or ineligible field ${JSON.stringify(`${parentType}.${fieldName}`)}`
        );
      }
      const fieldSchema = parentSchema[fieldName];
      if (!fieldSchema) {
        throw configError(
          `unknown or ineligible field ${JSON.stringify(`${parentType}.${fieldName}`)}`
        );
      }
      const descriptor = parentConfig[fieldName];
      if (!isRecord(descriptor)) {
        throw configError(`${parentType}.${fieldName} must be a descriptor`);
      }
      const descriptorKeys = Object.keys(descriptor).sort();
      if (
        descriptorKeys.length !== 3 ||
        descriptorKeys[0] !== 'argumentPath' ||
        descriptorKeys[1] !== 'kind' ||
        descriptorKeys[2] !== 'targetType'
      ) {
        throw configError(
          `${parentType}.${fieldName} must contain only kind, targetType, and argumentPath`
        );
      }
      if (descriptor.kind !== 'entity-from-argument') {
        throw configError(
          `${parentType}.${fieldName} has unsupported resolver kind`
        );
      }
      if (typeof descriptor.targetType !== 'string') {
        throw configError(
          `${parentType}.${fieldName} targetType must be a string`
        );
      }
      if (
        !Array.isArray(descriptor.argumentPath) ||
        descriptor.argumentPath.length === 0 ||
        !descriptor.argumentPath.every(
          (part: unknown): part is string => typeof part === 'string'
        )
      ) {
        throw configError(
          `${parentType}.${fieldName} argumentPath must be a non-empty string array`
        );
      }

      if (!fieldSchema.targets.includes(descriptor.targetType)) {
        throw configError(
          `${parentType}.${fieldName} cannot target ${JSON.stringify(descriptor.targetType)}`
        );
      }
      if (!pathMatches(descriptor.argumentPath, fieldSchema.argumentPaths)) {
        throw configError(
          `${parentType}.${fieldName} does not have ID argument path ${JSON.stringify(
            descriptor.argumentPath
          )}`
        );
      }

      const argumentPath = Object.freeze([
        ...descriptor.argumentPath,
      ]) as unknown as string[];
      compiled.push(
        Object.freeze({
          parentType,
          fieldName,
          targetType: descriptor.targetType,
          argumentPath,
        })
      );
    }
  }
  return Object.freeze(compiled);
}
