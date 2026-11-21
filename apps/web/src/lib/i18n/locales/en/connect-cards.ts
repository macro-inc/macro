/** Connect cards an agent presents for an app or MCP server it needs. */
export default {
  connect: 'Connect',
  connectName: 'Connect {{name}}',
  connected: 'Connected',
  app: 'App',
  mcpServer: 'MCP server · {{host}}',
  invalidAddress: 'invalid address',
  addHost: 'Add {{host}}?',
  ownerOnly: "Only the session's owner can connect this",
  addressInvalid: "This server's address isn't valid",
  connectFailed: 'Could not connect {{name}}. Please try again.',
  signInTryAgain: 'Could not start a sign-in for {{name}}. Please try again.',
  signInMayNeedNone:
    'Could not start a sign-in for {{name}}. If it needs none, reply to continue.',
  signInPageInsecure:
    "This server's sign-in page isn't secure (not https), so Macro won't open it",
  connectedReply: '{{name}} connected. Reply when you are ready to continue.',
  unsupported: 'Connectors are not available on this deployment',
};
