import type { ContainerSchemaType, RootSchemaType } from '@loro-mirror/core';

export type RawUpdate = Uint8Array;

export type LoroRawUpdate = Uint8Array;

export type GenericRootSchema = RootSchemaType<
  Record<string, ContainerSchemaType>
>;
