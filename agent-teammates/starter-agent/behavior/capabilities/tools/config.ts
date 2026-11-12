/**
 * The names and limits of the credential tools. Nothing else in the area
 * holds one.
 */

/** The owner of the tools' state directories. */
export const owner = "tools";

/** The stream a stored credential is logged to: its name and length, never its value. */
export const credentialLog = "credentials";

export type ToolsConfig = {
	/** How long a program handed a credential, or one whose output is stored, may take. */
	readonly commandTimeoutMs: number;
};

const minute = 60_000;

export const toolsConfig = (): ToolsConfig => ({
	commandTimeoutMs: 2 * minute,
});
