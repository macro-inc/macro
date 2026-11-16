import type { Config } from "./config.ts";
import type { Credentials } from "./credentials.ts";

/** The credential holding the token of the agent's own GitHub account. */
export const githubToken = "AGENT_GITHUB_TOKEN";

/**
 * Set in every environment the agent gives its children, with or without an
 * identity, so the guards can tell its sessions from the machine user's.
 */
export const sessionMarker = "AGENT_SESSION";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What a process runs with when it must not act as anyone: commits die on
 * the empty name, and gh and pushes have no login, so nothing falls back to
 * the machine's own account, which belongs to its user.
 */
export const noIdentity: Environment = {
	[sessionMarker]: "1",
	GH_TOKEN: undefined,
	GITHUB_TOKEN: undefined,
	GH_CONFIG_DIR: "/nonexistent",
	GIT_TERMINAL_PROMPT: "0",
	GIT_SSH_COMMAND: "false",
	GIT_AUTHOR_NAME: "",
	GIT_AUTHOR_EMAIL: "",
	GIT_COMMITTER_NAME: "",
	GIT_COMMITTER_EMAIL: "",
};

/**
 * The environment that makes git and gh act as the agent, so its commits,
 * pushes and PRs are its own and not the machine user's. Its identity lives
 * only here, never in any git config, which every session on the machine
 * shares. Without its token it fails closed.
 */
export const agentEnvironment = async ({
	config,
	credentials,
}: {
	readonly config: Pick<Config, "identity">;
	readonly credentials: Pick<Credentials, "get">;
}): Promise<Environment> => {
	const token = await credentials.get(githubToken).catch(() => undefined);
	if (token === undefined) return noIdentity;
	return {
		[sessionMarker]: "1",
		GH_TOKEN: token,
		GITHUB_TOKEN: undefined,
		GH_CONFIG_DIR: undefined,
		GIT_SSH_COMMAND: undefined,
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_NAME: config.identity.name,
		GIT_AUTHOR_EMAIL: config.identity.email,
		GIT_COMMITTER_NAME: config.identity.name,
		GIT_COMMITTER_EMAIL: config.identity.email,
	};
};
