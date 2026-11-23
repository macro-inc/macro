/**
 * A guardrail on what a run of the agent may do with a tool. Guards are pure:
 * given the call, each returns why it is refused, or undefined to let it by.
 * The same guards serve runs inside this process, through the SDK's hooks,
 * and Claude Code sessions outside it, through `bin/agent guard`.
 */
export type ToolCall = {
	/** The tool's name, e.g. `Bash`, `Write`, or an MCP tool's full name. */
	readonly tool: string;
	readonly input: unknown;
	/** Where the session is working. */
	readonly cwd: string;
	/** The session's environment, for guards that depend on who it runs as. */
	readonly environment: Readonly<Record<string, string | undefined>>;
	/** The event that woke the run, for guards that depend on why it runs. Absent for a session outside the agent's process. */
	readonly event?: {
		readonly name: string;
		readonly payload: unknown;
	};
};

export type Guard = {
	readonly name: string;
	readonly check: (call: ToolCall) => string | undefined;
};

/** The first refusal among the guards, with the guard's name, or undefined if every one lets the call by. */
export const refusal = (
	guards: readonly Guard[],
	call: ToolCall,
): string | undefined =>
	guards
		.map(({ name, check }) => {
			const reason = check(call);
			return reason === undefined ? undefined : `${name}: ${reason}`;
		})
		.find((reason) => reason !== undefined);

/** The command of a Bash call, or undefined for any other tool. */
export const bashCommand = ({ tool, input }: ToolCall): string | undefined =>
	tool === "Bash" &&
	typeof input === "object" &&
	input !== null &&
	"command" in input &&
	typeof input.command === "string"
		? input.command
		: undefined;

/** The file a Write or Edit call changes, or undefined for any other tool. */
export const editedFile = ({ tool, input }: ToolCall): string | undefined =>
	(tool === "Write" || tool === "Edit") &&
	typeof input === "object" &&
	input !== null &&
	"file_path" in input &&
	typeof input.file_path === "string"
		? input.file_path
		: undefined;
