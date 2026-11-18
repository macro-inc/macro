import { beginInteraction } from '@app/observability/flow';
import { makePersisted } from '@solid-primitives/storage';
import type { RemoteParticipant } from 'livekit-client';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  type CallLayout,
  type CallPin,
  callTileGridPosition,
  normalizeCallLayout,
  sameCallPin,
  selectCallStageParticipant,
} from '../core/call-layout';
import type { createCallPin } from './create-call-pin';

type CallStageState = {
  hidden: boolean;
  hiddenShareRevision: number;
};
type CallStageSources = {
  pin: ReturnType<typeof createCallPin<RemoteParticipant>>;
  participants: Accessor<RemoteParticipant[]>;
  screens: Accessor<RemoteParticipant[]>;
  screenSharing: Accessor<boolean>;
  isSpeaking: (participant: RemoteParticipant) => boolean;
  localSpeaking: Accessor<boolean>;
  mobile: Accessor<boolean>;
  compact: Accessor<boolean>;
};

export function createCallStage(options: CallStageSources) {
  const [state, setState] = createStore<CallStageState>({
    hidden: false,
    hiddenShareRevision: 0,
  });
  const activePin = options.pin.activePin;
  const togglePin = (target: CallPin<RemoteParticipant>) => {
    options.pin.togglePin(target);
    setHideParticipants(false);
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
