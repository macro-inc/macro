/** @macro-inc/brain public composition API. See docs/brain-api.md in your repo. */
export { Brain, type BrainDeps, type Wiring } from './brain.ts';
export { type Budget, SpendLedger } from './budget.ts';
export * as events from './events.ts';
export { HeartbeatStore } from './heartbeat.ts';
export { History } from './history.ts';
export { type JevConfig, judge } from './jev.ts';
export { Lanes } from './lanes.ts';
export { Memory } from './memory.ts';
export { Pool, Semaphore } from './pool.ts';
export * as presence from './presence.ts';
export {
  AgentSdkRunner,
  type RunHandle,
  type Runner,
  type Tier,
  type Turn,
} from './runner.ts';
export { type Routines, Schedules, type Trigger } from './schedules.ts';
export * as telemetry from './telemetry.ts';
export { Work } from './work.ts';
export { GitWriter, gitCli, Workspace } from './workspace.ts';

import type { BrainDeps } from './brain.ts';
import type { Health } from './control.ts';
import type { MustWakeFixture } from './learning.ts';
import type { PostResult } from './wiring.ts';
/** Abort means stop intake, finish in-flight turns and release resources. */
export interface BrainRuntime {
  /** Connect and buffer intake without mutating workspace queues; resolve when connected. */
  prepare(signal: AbortSignal): Promise<void>;
  health(): Promise<Health>;
  checkFixture(fixture: MustWakeFixture): Promise<boolean>;
  post(turn: string | null, channel: string, text: string): Promise<PostResult>;
  run(signal: AbortSignal): Promise<void>;
}
/** Export a factory as default from brain.ts. Dependencies contain scoped adapters. */
export type Composition = (
  deps: BrainDeps
) => BrainRuntime | Promise<BrainRuntime>;
export { tool } from '@anthropic-ai/claude-agent-sdk';
export { z } from 'zod';
export type { Candidate, Decision } from './jev.ts';
export type { LearningConfig, MustWakeFixture } from './learning.ts';
export type { BrainTool, TurnRequest } from './runner.ts';
export type {
  OutboundMessage,
  OutboundMiddleware,
  OutboundNext,
  PostResult,
  RouteItem,
  TierDefinition,
} from './wiring.ts';
