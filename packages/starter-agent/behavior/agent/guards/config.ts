/**
 * What the identity guards know a place by. The guards hold the rules; what
 * the rules are about is here, so a moved file is one edit.
 */

/** Where the agent's identity does come from, as the refusals name it. */
export const identitySource =
  '`base.environment()`, behavior/context/identity.ts';

/** Every git config file more than one session reads: a repository's, the user's, and the XDG one. */
export const sharedGitConfigFile =
  /(?:^|\/)(?:\.git\/config|\.gitconfig|\.config\/git\/config)$/;
