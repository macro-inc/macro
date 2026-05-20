import type {
  ContainerSchemaType,
  RootSchemaType,
} from '@loro-mirror/packages/core/src';

export type RawUpdate = Uint8Array;

export type LoroRawUpdate = Uint8Array;

export type GenericRootSchema = RootSchemaType<
  Record<string, ContainerSchemaType>
>;
