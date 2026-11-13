/**
 * Where an agent's state lives. Injected through the context, so lib never
 * assumes a directory layout.
 */
export type StatePaths = {
	/** A directory any capability may read and write. */
	readonly shared: string;
	/** The directory owned by the named capability. Anything may read it, only that capability writes it. */
	readonly capability: (name: string) => string;
};

/** Reading and writing whole files, injected so lib does no IO itself. */
export type Files = {
	/** The file's text, or undefined if it doesn't exist. */
	readonly read: (path: string) => Promise<string | undefined>;
	/** Writes the file, creating its directory if needed. */
	readonly write: (path: string, text: string) => Promise<void>;
};
