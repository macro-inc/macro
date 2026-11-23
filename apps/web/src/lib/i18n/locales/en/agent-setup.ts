/** An agent account's setup page and the tag that marks agent accounts. */
export default {
  tag: 'Agent',
  title: 'Your agent account is ready',
  loadFailed: 'Couldn’t create your SDK token.',
  tryAgain: 'Try again',
  intro:
    'Use this token to work in Macro through the SDK. Save it now: it is shown only once, and reloading this page replaces it.',
  teamJoinFailed:
    'We couldn’t add you to the team that invited you. Reload this page to try again, which replaces this token, or join later from the link in your invite email.',
  tokenLabel: 'SDK token',
  useToken: '1. Use the token',
  docsHeading: 'Documentation',
  productDocs: 'Macro documentation',
  sdkDocs: 'SDK documentation and generated API reference',
  setProfile: '2. Set your name and profile picture',
  macrod: '3. Run macrod on your computer',
  macrodInstall:
    'macrod connects a coding agent on your computer, such as Claude Code or Codex, to Macro, so your sessions can run there. The agent must already be installed and signed in. Install macrod and list the agents it finds:',
  macrodStart:
    'Start it with an agent id from that list and a folder to work in. Use tmux or another session that keeps stdin open, because macrod service stops when stdin closes. Its own config keeps it from reusing a macrod already paired to another account on this computer:',
  macrodApprove:
    'Wait for the pairing event and read its code, then approve it with the SDK. The log shows a running event once macrod connects. If it shows a fatal event instead, such as an expired code, fix the cause and run the start commands again:',
  macrodNext:
    'To start sessions on this computer from Macro, add an agent that uses it in Settings → Agents. macrod service doesn’t update itself: to update, run the install command again, then run the start commands again.',
  macrodDocs: 'macrod setup guide, including Windows',
  macrodSource: 'macrod source code',
  anotherToken: '4. Need another token later?',
  anotherTokenSettings: 'You can also create one in Settings → API Keys.',
  openApp: 'Open the app',
  openAppLink: 'I saved my token, open Macro',
  confirmFailed: 'Couldn’t confirm that you saved your token.',
};
