export default {
  inviteTitle: 'Invite an agent',
  agent: 'Agent',
  nameIt: 'Name it',
  namePlaceholder: 'Ada',
  tooLong: {
    one: 'Use at most {{count}} character',
    other: 'Use at most {{count}} characters',
  },
  voice: 'Voice',
  chooseVoice: 'Choose a voice',
  loadingVoices: 'Loading voices…',
  showVoices: 'Show voices',
  voicesFailed: "Couldn't load voices.",
  playSample: 'Play sample',
  stopSample: 'Stop sample',
  sampleFailed: "Couldn't play this sample. Try again.",
  changeVoice: 'Change voice',
  voiceTitle: 'Voice for {{name}}',
  voiceNextCall: 'The new voice is used from its next call.',
  voiceLoadFailed: "Couldn't load the current voice.",
  saveVoice: 'Save voice',
  savingVoice: 'Saving…',
  voiceSaved: '{{name}} will use the new voice on its next call',
  voiceInvalid: "That voice isn't available. Choose another one.",
  voiceSaveFailed:
    "Couldn't save the voice. Your choice is still selected; try again.",
  giveItAComputer: 'Give it a computer',
  sizesFailed: "Couldn't load computer sizes.",
  tryAgain: 'Try again',
  add: 'Add {{name}}',
  addPriced: 'Add {{name}} · {{price}}',
  addOn: 'Add {{name}} on {{host}}',
  /** An agent on a machine the viewer didn't pair, so its name isn't theirs to read. */
  failedImageUnavailable:
    "Couldn't download the agent's runtime on {{host}}. Check its internet connection.",
  failedImageMismatch:
    "The runtime downloaded on {{host}} didn't match the one Macro sent.",
  failedEngineRefused:
    "The container engine on {{host}} wouldn't start it. Check that it's running.",
  failedBadConfiguration:
    "Its settings didn't apply on {{host}}. Macro sends them once more.",
  failedIncompatibleRuntime:
    'It needs a newer runtime image than {{host}} has.',
  failedCrashLoop: 'It kept crashing on {{host}}.',
  failedNetworkIsolation:
    "Couldn't lock down its network on {{host}}, so it isn't running.",
  failedEgressBlocked:
    "{{host}} has no route to the internet, so it isn't running. It starts once {{host}} is back online.",
  failedHostUnsupported:
    "Agents can't run on {{host}}. Move it to another computer.",
  hostRemoved:
    "Stopped: the computer it ran on can no longer host it for this team. Its chats and memory are kept; its inviter or the team's owner can move it to one of their computers.",
  rolledBackCrashLoop:
    'Running the previous version: the update kept crashing.',
  rolledBackImageUnavailable:
    "Running the previous version: the update couldn't be downloaded.",
  rolledBackOther: "Running the previous version: the update didn't start.",
  ownersComputer: "its owner's computer",
  buyAComputer: 'Buy a computer',
  yourComputers: 'Your computers',
  adding: 'Adding {{name}}…',
  tryAgainPriced: 'Try again · {{price}}',
  declined:
    'Your card was declined. Nothing was charged and nothing was set up. Update the card, or try again if your bank has cleared it.',
  updateCard: 'Update card',
  noSizeForSale: 'Every computer size is sold out right now. Try again later.',
  noRoom:
    'No room for a {{size}} computer right now. Nothing was charged. Pick another size.',
  notStarted:
    "{{name}} didn't start on its computer. Retry starts it again on the same computer; you aren't charged again.",
  refunded:
    "{{name}} didn't start again. The charge was undone and the computer released. Retry starts a fresh one; you aren't charged twice.",
  retryStart: 'Retry',
  inviteInProgress: 'This agent is still being added. Wait a moment.',
  invalid: 'Check the name, job description, and personality.',
  notEnabled: "Agent teammates aren't available for this team yet.",
  computerUnavailable: "Couldn't buy a computer for this agent.",
  repositoryFailed:
    "Couldn't set up the agent's workspace. Nothing was charged. Try again.",
  failed: "Couldn't invite the agent. Try again.",
  statusProvisioning: 'Setting up',
  statusStarting: 'Starting',
  statusRunning: 'Running',
  statusPaused: 'Paused',
  statusUnhealthy: 'Not responding',
  statusFailed: 'Needs attention',
  statusReleased: 'Released',
  statusSetupFailed: 'Setup failed',
  statusOffline: 'Offline',
  statusNotRunning: 'Not running',
  retrySetup: 'Retry',
  retryFailed: "Couldn't retry setting up {{name}}. Try again.",
  readyNotice: '{{name}} is ready',
  readyNoticeBody: 'Message {{name}} to get started.',
  failedNotice: "{{name}} couldn't be set up",
  failedNoticeBody: "Retry from {{name}}'s row in Members.",
  messageAgent: 'Message {{name}}',
  openDirectMessageFailed: "Couldn't open the conversation. Try again.",
  connectClaude: 'Connect Claude plan',
  reconnectClaude: 'Reconnect Claude plan',
  dmSettingUp: "{{name}} is still being set up. It'll answer once it's ready.",
  dmSetupFailed: "{{name}} isn't running: setup failed.",
  dmOffline: "{{name}} isn't running: its computer is offline.",
  dmNotRunning: "{{name}} isn't running right now.",
  remove: 'Remove agent',
  removeTitle: 'Remove {{name}}?',
  removeBody: "Its computer and files are deleted. This can't be undone.",
  removeConfirm: 'Remove',
  removeFailed: "Couldn't remove {{name}}. Try again.",
  connectClaudeTitle: 'Connect {{name}} to your Claude plan',
  connectClaudeBody:
    '{{name}} uses your Claude Pro or Max plan instead of Macro credits, starting with its next task.',
  connectClaudeFootnote:
    "Only {{name}}'s computer keeps this sign-in. Revoke it any time in claude.ai settings.",
  claudeSignedIn: '{{name}} now uses your Claude plan',
  claudeCredits: 'Claude: Macro credits',
  claudeSignedInState: 'Claude: your plan',
  claudeExpired: 'Claude sign-in expired',
  useCreditsTitle: 'Switch {{name}} to Macro credits?',
  useCreditsBody:
    "{{name}} signs out of Claude and runs on your team's Macro credits.",
  useCreditsFailed: "Couldn't switch {{name}} to Macro credits. Try again.",
};
