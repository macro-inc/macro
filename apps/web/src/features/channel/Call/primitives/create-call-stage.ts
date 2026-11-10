import { beginInteraction } from '@app/observability/flow';
import { makePersisted } from '@solid-primitives/storage';
import type { RemoteParticipant } from 'livekit-client';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import {
  activeCallPin,
  type CallLayout,
  type CallPin,
  callTileGridPosition,
  normalizeCallLayout,
  sameCallPin,
  selectCallStageParticipant,
} from '../core/call-layout';

type CallStageState = {
  pin?: CallPin<RemoteParticipant>;
  pinRevision: number;
  hidden: boolean;
  hiddenShareRevision: number;
};
type ActivePin = { revision: number; pin?: CallPin<RemoteParticipant> };
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
  const [state, setState] = createStore<CallStageState>({
    pinRevision: 0,
    hidden: false,
    hiddenShareRevision: 0,
  });
  const selectedPin = () => unwrap(state.pin);
  const setSelectedPin = (pin: CallPin<RemoteParticipant> | undefined) =>
    setState(
      produce((state) => {
        state.pin = pin;
        state.pinRevision += 1;
      })
    );
  const selected = createMemo<ActivePin>((previous) => {
    const revision = state.pinRevision;
    // Once a publication or participant leaves, the same selection stays retired.
    if (previous?.revision === revision && !previous.pin) return previous;
    return {
      revision,
      pin: activeCallPin(
        selectedPin(),
        options.participants(),
        options.screens(),
        options.screenSharing()
      ),
    };
  });
  const activePin = () => selected().pin;
  const togglePin = (target: CallPin<RemoteParticipant>) => {
    const interaction = beginInteraction('call.pin');
    try {
      setSelectedPin(sameCallPin(activePin(), target) ? undefined : target);
      setHideParticipants(false);
    } finally {
      interaction.end();
    }
  };

  const hasAnyScreenShare = createMemo(
    () => options.screenSharing() || options.screens().length > 0
  );
  const shareRevision = createMemo((previous: number) => {
    hasAnyScreenShare();
    return previous + 1;
  }, 0);

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
  const hideParticipants = () =>
    state.hidden && state.hiddenShareRevision === shareRevision();
  const setHideParticipants = (hidden: boolean) =>
    setState({ hidden, hiddenShareRevision: shareRevision() });
  const changeParticipantVisibility = (value: boolean) => {
    const interaction = beginInteraction('call.participants.visibility');
    try {
      setHideParticipants(value);
    } finally {
      interaction.end();
    }
  };
  const pinnedShare = () => {
    const selected = activePin();
    if (!selected || typeof selected !== 'object') return undefined;
    return 'share' in selected ? selected.share : undefined;
  };
  const pinnedPerson = () => {
    const selected = activePin();
    if (!selected || typeof selected !== 'object') return undefined;
    return 'share' in selected ? undefined : selected;
  };
  const showScreenShare = () => hasAnyScreenShare() && !activePin();
  const speakerLayout = () => layout() === 'speaker' || layout() === 'sidebar';
  const primary = () =>
    selectCallStageParticipant(
      options.participants(),
      (participant) => options.isSpeaking(participant),
      options.localSpeaking()
    );
  const spotlight = () => {
    if (!speakerLayout() || options.participants().length === 0) return false;
    return !hasAnyScreenShare() && !activePin();
  };
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
    if (!target || typeof target !== 'object') return undefined;
    return 'share' in target ? undefined : target;
  };
  const localOnStage = () => stageTarget() === 'local';
  const selfInGrid = () => {
    if (localOnStage() || options.participants().length === 0) return false;
    if (layout() !== 'auto') return true;
    if (staged() && activePin()) return true;
    if (options.mobile()) return staged() || !hasAnyScreenShare();
    return options.compact() && !hasAnyScreenShare();
  };
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
