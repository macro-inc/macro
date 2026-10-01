import type {
  ContainerSchemaType,
  RootSchemaType,
} from '@macro-inc/automerge/mirror';

export type RawUpdate = Uint8Array;

export type AutomergeRawUpdate = Uint8Array;

export type GenericRootSchema = RootSchemaType<
  Record<string, ContainerSchemaType>
>;
