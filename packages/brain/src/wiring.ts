/** Hooks for changing the default composition without replacing its runtime. */
import type { Brain } from './brain.ts';
import type { Conversation } from './control.ts';
import type { MacroEvent } from './events.ts';
import type { Entry } from './history.ts';
import type { judge } from './jev.ts';
import type { BrainTool, Outcome, Tier, Turn, TurnRequest } from './runner.ts';
import type { Trigger, Wake } from './schedules.ts';
import type { CreatedTask } from './work.ts';

export type Awaitable<T> = T | Promise<T>;
export type RouteItem =
  | { kind: 'respond'; lane: string; batch: Entry[] }
  | { kind: 'heartbeat'; reason: string }
  | {
      kind: 'work';
      task: CreatedTask;
      conversation: Conversation;
      description: string;
    };
export type OutboundMessage = Conversation & {
  turn: string | null;
  text: string;
};
export type PostResult = { id: string } | { suppressed: true; reason: string };
export type OutboundNext = (message: OutboundMessage) => Promise<PostResult>;
export type OutboundMiddleware = (
  message: OutboundMessage,
  next: OutboundNext
) => Promise<PostResult>;
/** Call transports supply an opaque identity and typed lifecycle; no transport is installed here. */
export type BrainCall = {
  id: string;
  phase: 'incoming' | 'connected' | 'ended';
  metadata: Readonly<Record<string, unknown>>;
};
export type TierDefinition = {
  concurrency: number;
  perRunUsd: number;
  speaking?: boolean;
};

export type Wiring = {
  subscriptions?: string[];
  onEvent?(event: MacroEvent, brain: Brain): Promise<void>;
  relevance?: typeof judge;
  tiers?: Record<string, TierDefinition>;
  route?(item: RouteItem): Awaitable<Tier>;
  /** Runs before admission; budget remains bounded by tier and daily limits. */
  beforeTurn?(turn: TurnRequest): Awaitable<TurnRequest>;
  /** Receives the actual admitted turn (including effective budget and tools). */
  afterTurn?(turn: Turn, outcome: Outcome): Awaitable<void>;
  tools?: BrainTool[];
  schedules?: { note: string; trigger: Trigger }[];
  /** Void/true handles the wake in code; false requests the default heartbeat turn. */
  onSchedule?(trigger: Wake, brain: Brain): Awaitable<void | boolean>;
  outbound?: OutboundMiddleware[];
  onCall?(call: BrainCall, brain: Brain): Awaitable<void>;
};
