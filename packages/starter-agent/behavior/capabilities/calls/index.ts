/**
 * Calls: everything the agent can do about its voice, as capabilities. The
 * watcher (the `calls` source and its handler) answers and leaves calls on
 * its own; these are what a wake, a call's brain or a person uses to place a
 * call, ask it onto one, hang up, post in a call's chat, and read a call
 * back.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import { postCallChat } from './capabilities/chat.ts';
import {
  askOntoCall,
  callReport,
  hangUp,
  noCall,
  placeCall,
} from './capabilities/ledgers.ts';
import { joinCall, replayCall } from './capabilities/voice.ts';
import {
  alwaysJoinCalls,
  callDecisions,
  callsNow,
} from './capabilities/watch.ts';
import type { CallsContext } from './context.ts';

// Scripts import the functions from the module's file, which is this one.
export { postCallChat } from './capabilities/chat.ts';
export {
  askOntoCall,
  callReport,
  hangUp,
  noCall,
  placeCall,
} from './capabilities/ledgers.ts';
export { joinCall, replayCall } from './capabilities/voice.ts';
export {
  alwaysJoinCalls,
  callDecisions,
  callsNow,
} from './capabilities/watch.ts';

/** `calls` is the context's own value, so the module can't have the name. */
export const callsModule = module({
  name: 'calls',
  summary:
    "Your voice on Macro calls: place a call, be asked onto one, hang up, post in a call's chat, see what the watcher sees and decided, and read a call back.",
  file: import.meta.path,
  functions: {
    placeCall,
    noCall,
    askOntoCall,
    hangUp,
    postCallChat,
    callsNow,
    callDecisions,
    alwaysJoinCalls,
    callReport,
    joinCall,
    replayCall,
  },
});

export const callsCapabilities =
  behavior<CallsContext>().capability(callsModule);
