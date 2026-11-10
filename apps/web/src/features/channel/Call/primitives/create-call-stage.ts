import { beginInteraction } from '@app/observability/flow';
import { makePersisted } from '@solid-primitives/storage';
import type { RemoteParticipant } from 'livekit-client';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import {
  activeCallPin,
  type CallLayout,
  type CallPin,
  callTileGridPosition,
  normalizeCallLayout,
  sameCallPin,
  selectCallStageParticipant,
} from '../call-layout';

type CallStageState = { pin?: CallPin<RemoteParticipant>; hidden: boolean };
type CallStageSources = {
  participants: Accessor<RemoteParticipant[]>;
  screens: Accessor<RemoteParticipant[]>;
  screenSharing: Accessor<boolean>;
  isSpeaking: (participant: RemoteParticipant) => boolean;
  localSpeaking: Accessor<boolean>;
  mobile: Accessor<boolean>;
  compact: Accessor<boolean>;
};

export function createCallStage(options: CallStageSources) {
  // The same selection owns participant and screen pins. A removed target never
  // becomes pinned again if its identity reconnects later.
  const [state, setState] = createStore<CallStageState>({ hidden: false });
  const selectedPin = () => unwrap(state.pin);
  const setSelectedPin = (pin: CallPin<RemoteParticipant> | undefined) =>
    setState(
      produce((state) => {
        state.pin = pin;
      })
    );
  const activePin = () =>
    activeCallPin(
      selectedPin(),
      options.participants(),
      options.screens(),
      options.screenSharing()
    );
  const togglePin = (target: CallPin<RemoteParticipant>) => {
    const interaction = beginInteraction('call.pin');
    try {
      setSelectedPin(sameCallPin(activePin(), target) ? undefined : target);
      setHideParticipants(false);
    } finally {
      interaction.end();
    }
  };

  createEffect(() => {
    // Consume both roster and publication changes before clearing the stored pin.
    if (selectedPin() && !activePin()) setSelectedPin(undefined);
  });

  const hasAnyScreenShare = () =>
    options.screenSharing() || options.screens().length > 0;

  const [savedLayout, setSavedLayout] = makePersisted(
    createSignal<CallLayout>('auto'),
    {
      name: 'call.layout',
      deserialize: (value) => {
        try {
          return normalizeCallLayout(JSON.parse(value));
        } catch {
          return 'auto';
        }
      },
    }
  );
  const layout = () => (options.mobile() ? 'auto' : savedLayout());
  const hideParticipants = () => state.hidden;
  const setHideParticipants = (hidden: boolean) => setState('hidden', hidden);
  const changeParticipantVisibility = (value: boolean) => {
    const interaction = beginInteraction('call.participants.visibility');
    try {
      setHideParticipants(value);
    } finally {
      interaction.end();
    }
  };
  createEffect(
    on(hasAnyScreenShare, (sharing) => {
      if (!sharing) setHideParticipants(false);
    })
  );
  const pinnedShare = () => {
    const selected = activePin();
    return selected && typeof selected === 'object' && 'share' in selected
      ? selected.share
      : undefined;
  };
  const pinnedPerson = () => {
    const selected = activePin();
    return selected && typeof selected === 'object' && !('share' in selected)
      ? selected
      : undefined;
  };
  const showScreenShare = () => hasAnyScreenShare() && !activePin();
  const speakerLayout = () => layout() === 'speaker' || layout() === 'sidebar';
  const primary = () =>
    selectCallStageParticipant(
      options.participants(),
      (participant) => options.isSpeaking(participant),
      options.localSpeaking()
    );
  const spotlight = () =>
    speakerLayout() &&
    options.participants().length > 0 &&
    !hasAnyScreenShare() &&
    !activePin();
  const stageTarget = (): CallPin<RemoteParticipant> | undefined => {
    const pinned = activePin();
    if (pinned) return pinned;
    if (hasAnyScreenShare() && layout() !== 'grid') {
      if (options.screenSharing()) return 'local-share';
      const share = options.screens()[0];
      if (share) return { share };
    }
    return spotlight() ? primary() : undefined;
  };
  const staged = () => stageTarget() !== undefined;
  const isStage = (target: CallPin<RemoteParticipant>) =>
    sameCallPin(stageTarget(), target);
  const sideStrip = () =>
    layout() === 'sidebar' &&
    (staged() || showScreenShare()) &&
    !hideParticipants();
  const stagePerson = () => {
    const target = stageTarget();
    return target && typeof target === 'object' && !('share' in target)
      ? target
      : undefined;
  };
  const localOnStage = () => stageTarget() === 'local';
  const selfInGrid = () =>
    !localOnStage() &&
    (layout() !== 'auto' ||
      (staged() && !!activePin()) ||
      (options.mobile() && (staged() || !hasAnyScreenShare())) ||
      (options.compact() && !hasAnyScreenShare())) &&
    options.participants().length > 0;
  const stripTargets = () => {
    const targets: CallPin<RemoteParticipant>[] = [
      ...(options.screenSharing() ? ['local-share' as const] : []),
      ...options.screens().map((share) => ({ share })),
      ...options.participants(),
      ...(selfInGrid() ? ['local' as const] : []),
    ];
    return targets.filter((target) => !isStage(target));
  };
  const tilePosition = (target: CallPin<RemoteParticipant>) => {
    if (!staged()) return undefined;
    const index = stripTargets().findIndex((item) => sameCallPin(item, target));
    if (!isStage(target) && index < 0) return undefined;
    return callTileGridPosition(
      isStage(target),
      index,
      stripTargets().length,
      sideStrip()
    );
  };

  return {
    activePin,
    togglePin,
    hasAnyScreenShare,
    layout,
    setSavedLayout,
    hideParticipants,
    changeParticipantVisibility,
    pinnedShare,
    pinnedPerson,
    showScreenShare,
    speakerLayout,
    primary,
    spotlight,
    stageTarget,
    staged,
    isStage,
    sideStrip,
    stagePerson,
    localOnStage,
    selfInGrid,
    stripTargets,
    tilePosition,
  };
}
