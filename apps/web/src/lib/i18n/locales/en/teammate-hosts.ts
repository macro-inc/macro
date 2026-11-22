export default {
  giveItAComputer: 'Give it a computer',
  newComputer: 'New computer',
  ownComputer: 'My own computer',
  ownComputerHint:
    'It runs in a container on one of your computers, with macrod and Docker or Podman. No computer is bought.',
  loadingHosts: 'Looking for your computers…',
  hostsFailed: "Couldn't list your computers.",
  noHosts:
    'None of your computers can host an agent yet. Pair one that has macrod and Docker or Podman.',
  pairComputer:
    'To add one, install macrod on it and pair it from Settings → Machines.',
  hostExperimental: 'Experimental',
  hostOffline: 'Offline',
  hostNotReported: 'Update macrod to host agents',
  hostNoEngine: 'Install Podman or Docker to host agents here',
  hostEngineUnreachable: "Can't reach {{engine}} on {{host}} right now",
  engineEither: 'Docker or Podman',
  checkAgain: 'Check again',
  hostUnsupportedPlatform:
    "There's no agent runtime for this computer's system yet",
  hostBelowFloorCpus: 'Needs at least 2 CPUs',
  hostBelowFloorMemory: 'Needs at least 8 GB of memory',
  hostBelowFloorDisk: 'Needs at least 20 GB free',
  hostInnerSandbox:
    "This computer's security settings block the agent's sandbox",
  hostNetworkIsolation: "Can't lock down an agent's network on this machine",
  hostEngine: '{{engine}} {{version}}',
  hostRootless: 'rootless',
  trustTitle: 'Anything running as you on {{host}} can act as {{name}}',
  trustTitleUnnamed:
    'Anything running as you on {{host}} can act as this agent',
  trustBody:
    'That includes coding agents macrod runs there and anyone with admin on {{host}}: they can read its files and credentials. It reaches the internet, but not {{host}} or the other machines on its network.',
  computersFailed: "Couldn't load computers.",
  ownComputerCaption:
    '{{name}} gets its own account and runs on {{host}}. It says hi once it starts.',
  chooseHost: 'Choose one of your computers to continue.',
  hostNotEligible:
    "That computer can't host an agent right now. Choose another.",
  selfHostedNotEnabled:
    "Running agents on your own computers isn't available yet.",
  statusDownloading: 'Downloading',
  statusMoving: 'Moving',
  moveToComputer: 'Move to another computer',
  moveTitle: 'Move {{name}}',
  moveBody:
    '{{name}} saves its memory and stops on {{from}}, then starts on the computer you choose. Its browser sign-ins and its Claude sign-in stay behind.',
  moveBodyParked:
    '{{name}} is paused. It starts on the computer you choose, with its chats and memory. Its browser sign-ins and its Claude sign-in stayed behind.',
  moveConfirm: 'Move',
  moving: 'Moving…',
  moveFailed: "Couldn't move {{name}}. Try again.",
  runsOn: '· on {{host}}',
  movingTo: 'to {{host}}',
  hostFailed: "{{name}} didn't start on {{host}}. To see why, run this there:",
  removeBodyOwn:
    "It stops on {{host}}, and its files there are deleted. Its memory stays in its repository. This can't be undone.",
  ownClaudeHint: 'To use your Claude plan, run this on {{host}}:',
  copyCommand: 'Copy command',
  copyCommandFailed: "Couldn't copy the command.",
  moveNoOtherHost:
    'None of your other computers can take {{name}}. Pair another one in Settings → Machines.',
  tryAgain: 'Try again',
};
