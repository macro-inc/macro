export default {
  giveItAComputer: 'Give it a computer',
  newComputer: 'New computer',
  ownComputer: 'My own computer',
  ownComputerHint:
    'It runs in a container on one of your computers, with macrod and Docker or Podman. No computer is bought.',
  egressNote:
    'An agent on your computer can reach whatever its network can reach, including other machines on it and, on a cloud VM, its metadata service.',
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
  hostEngineUnreachable:
    "Podman or Docker didn't answer. Is it running, and can you use it without sudo?",
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
  trustTitle: 'Anyone with admin on {{host}} can act as {{name}}',
  trustBody:
    "They can read {{name}}'s files and credentials. {{name}} can reach whatever {{host}}'s network can reach, including other machines on it and, on a cloud VM, its metadata service.",
  ownComputerCaption:
    '{{name}} gets its own account and runs on {{host}}. It says hi once it starts.',
  chooseHost: 'Choose one of your computers to continue.',
  hostNotEligible:
    "That computer can't host an agent right now. Choose another.",
  selfHostedNotEnabled:
    "Running agents on your own computers isn't available yet.",
  statusDownloading: 'Downloading',
  moveToComputer: 'Move to another computer',
  moveTitle: 'Move {{name}}',
  moveBody:
    '{{name}} saves its memory and stops on {{from}}, then starts on the computer you choose. Its browser sign-ins and its Claude sign-in stay behind.',
  moveConfirm: 'Move',
  moveFailed: "Couldn't move {{name}}. Try again.",
  runsOn: 'Runs on {{host}}',
  hostFailed:
    "{{name}} didn't start on {{host}}. Run `macrod teammate logs` there to see why; nothing was bought.",
  removeBodyOwn:
    "It stops on {{host}}, and its files there are deleted. Its memory stays in its repository. This can't be undone.",
  ownClaudeHint:
    'To use your Claude plan, run `macrod teammate sign-in` on {{host}}.',
  tryAgain: 'Try again',
};
