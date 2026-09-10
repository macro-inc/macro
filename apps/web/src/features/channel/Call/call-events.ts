import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { parseWebsocketPayload } from '@service-connection/websocket-payload';
import { match } from 'ts-pattern';

/**
 * Single source of truth for the call events broadcast over the connection
 * gateway websocket. The wire payloads are hand-rolled `serde_json::json!`
 * literals in `crates/call/src/domain/service.rs` — there are no generated
 * types for them — so the snake_case shapes below are mirrored by hand and kept
 * private to this module. Consumers only ever see the normalized camelCase
 * events.
 */

type CallStartedWirePayload = {
  channel_id?: string;
  call_id?: string;
  created_by?: string | null;
};

type CallEndedWirePayload = {
  channel_id?: string;
  call_id?: string;
};

type CallAnsweredWirePayload = {
  channel_id?: string;
  call_id?: string;
  user_id?: string | null;
};

type CallShareWithTeamToggledWirePayload = {
  channel_id?: string;
  call_id?: string;
  share_with_team?: boolean;
  toggled_by?: string | null;
};

/** A call was started in a channel the user is a member of. */
export type CallStartedEvent = {
  channelId: string;
  callId: string;
  createdBy: string | null;
};

/** A call ended — broadcast to every member of the channel. */
export type CallEndedEvent = {
  channelId: string;
  callId: string;
};

/**
 * The user joined a call on one of their devices. Sent only to the answering
 * user's own connections, so every other device can stop ringing.
 */
export type CallAnsweredEvent = {
  channelId: string | null;
  callId: string;
  answeredBy: string | null;
};

/** A participant flipped the call's share-with-team flag. */
export type CallShareWithTeamToggledEvent = {
  channelId: string;
  callId: string;
  shareWithTeam: boolean;
  toggledBy: string | null;
};

export type CallEvent =
  | ({ type: 'call_started' } & CallStartedEvent)
  | ({ type: 'call_ended' } & CallEndedEvent)
  | ({ type: 'call_answered' } & CallAnsweredEvent)
  | ({
      type: 'call_share_with_team_toggled';
    } & CallShareWithTeamToggledEvent);

export type CallEventType = CallEvent['type'];

const CALL_EVENT_TYPES = new Set<string>([
  'call_started',
  'call_ended',
  'call_answered',
  'call_share_with_team_toggled',
]);

export function isCallEventType(type: string): type is CallEventType {
  return CALL_EVENT_TYPES.has(type);
}

/**
 * Normalizes a raw websocket frame into a typed call event, or `null` when the
 * frame is not a call event, is malformed, or is missing the identifiers every
 * consumer needs. Pure — exported for tests.
 */
export function parseCallEvent(
  type: string,
  rawData: unknown
): CallEvent | null {
  if (!isCallEventType(type)) return null;

  const payload = parseWebsocketPayload<unknown>(type, rawData);
  if (!payload || typeof payload !== 'object') return null;

  return match(type)
    .with('call_started', (eventType) => {
      const {
        channel_id: channelId,
        call_id: callId,
        created_by: createdBy,
      } = payload as CallStartedWirePayload;
      if (!channelId || !callId) return null;
      return {
        type: eventType,
        channelId,
        callId,
        createdBy: createdBy ?? null,
      };
    })
    .with('call_ended', (eventType) => {
      const { channel_id: channelId, call_id: callId } =
        payload as CallEndedWirePayload;
      if (!channelId || !callId) return null;
      return { type: eventType, channelId, callId };
    })
    .with('call_answered', (eventType) => {
      // `channel_id` is on the wire but no consumer needs it, so only the call
      // id is required here.
      const {
        channel_id: channelId,
        call_id: callId,
        user_id: answeredBy,
      } = payload as CallAnsweredWirePayload;
      if (!callId) return null;
      return {
        type: eventType,
        channelId: channelId ?? null,
        callId,
        answeredBy: answeredBy ?? null,
      };
    })
    .with('call_share_with_team_toggled', (eventType) => {
      const {
        channel_id: channelId,
        call_id: callId,
        share_with_team: shareWithTeam,
        toggled_by: toggledBy,
      } = payload as CallShareWithTeamToggledWirePayload;
      if (!channelId || !callId || typeof shareWithTeam !== 'boolean') {
        return null;
      }
      return {
        type: eventType,
        channelId,
        callId,
        shareWithTeam,
        toggledBy: toggledBy ?? null,
      };
    })
    .exhaustive();
}

type CallEventHandlers = {
  /**
   * `isFromSelf` is true when this client's user started the call, i.e. a
   * multi-device echo. The event is still delivered so consumers can update
   * shared state before deciding whether to notify.
   */
  onCallStarted?: (event: CallStartedEvent & { isFromSelf: boolean }) => void;
  onCallEnded?: (event: CallEndedEvent) => void;
  onCallAnswered?: (event: CallAnsweredEvent) => void;
  onShareWithTeamToggled?: (event: CallShareWithTeamToggledEvent) => void;
};

/**
 * Subscribes to the call events on the connection-gateway websocket, handling
 * the feature-flag gate, payload parsing, field validation and the answered-on-
 * another-device self-filter once for every consumer.
 *
 * Must be called during component setup, under `<UserContextProvider>`.
 */
export function createCallEventsEffect(handlers: CallEventHandlers) {
  const userId = useUserId();

  createConnectionWebsocketEffect((data) => {
    // Check the type before parsing so we don't JSON.parse every frame the app
    // receives just to discard it.
    if (!isCallEventType(data.type)) return;
    if (!ENABLE_CALLS) return;

    const event = parseCallEvent(data.type, data.data);
    if (!event) return;

    match(event)
      .with({ type: 'call_started' }, (event) => {
        handlers.onCallStarted?.({
          channelId: event.channelId,
          callId: event.callId,
          createdBy: event.createdBy,
          isFromSelf: !!event.createdBy && event.createdBy === userId(),
        });
      })
      .with({ type: 'call_ended' }, (event) => {
        handlers.onCallEnded?.({
          channelId: event.channelId,
          callId: event.callId,
        });
      })
      .with({ type: 'call_answered' }, (event) => {
        // Sent only to the answering user's connections, but guard anyway.
        if (event.answeredBy && event.answeredBy !== userId()) return;
        handlers.onCallAnswered?.({
          channelId: event.channelId,
          callId: event.callId,
          answeredBy: event.answeredBy,
        });
      })
      .with({ type: 'call_share_with_team_toggled' }, (event) => {
        handlers.onShareWithTeamToggled?.({
          channelId: event.channelId,
          callId: event.callId,
          shareWithTeam: event.shareWithTeam,
          toggledBy: event.toggledBy,
        });
      })
      .exhaustive();
  });
}
