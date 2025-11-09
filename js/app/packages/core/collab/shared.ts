import type {
  ContainerSchemaType,
  InferType,
  RootSchemaType,
} from '@loro-mirror/packages/core/src';

export type RawUpdate = Uint8Array;

export type LoroRawUpdate = Uint8Array;

export type SyncState<S extends GenericRootSchema = GenericRootSchema> =
  InferType<S>;

export type GenericRootSchema = RootSchemaType<
  Record<string, ContainerSchemaType>
>;

export type SubscriptionCallback<T> = (message: T) => void;

export type Subscription = () => void;
