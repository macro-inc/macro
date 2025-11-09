import type { CanvasSpec } from '../block-canvas/definition';
import type { BlockChatSpec } from '../block-chat/blockClient';
import type { MarkdownBlockSpec } from '../block-md/definition';
import type { BlockName } from './block';

// Base type for all block method specs
export type BlockMethodSpec = Record<
  string,
  (...args: any[]) => any | Promise<any>
>;

export type SharedBlockSpec = {
  goToLocationFromParams: (params: Record<string, any>) => Promise<void>;
};

// Ensure all block specs extend BlockMethodSpec
type EmptySpec = {};
type AssertSpec<T> = T extends BlockMethodSpec ? T : EmptySpec;

export interface BlockMethodRegistry {
  chat: AssertSpec<BlockChatSpec>;
  channel: EmptySpec;
  write: EmptySpec;
  pdf: EmptySpec;
  html: EmptySpec;
  md: AssertSpec<MarkdownBlockSpec>;
  code: EmptySpec;
  image: EmptySpec;
  canvas: AssertSpec<CanvasSpec>;
  project: EmptySpec;
  start: EmptySpec;
  unknown: EmptySpec;
  video: EmptySpec;
  email: EmptySpec;
  contact: EmptySpec;
  color: EmptySpec;
  component: EmptySpec;
}

// Type helper to get the method spec for a block name
export type BlockMethodsFor<T extends BlockName> = SharedBlockSpec &
  BlockMethodRegistry[T];
