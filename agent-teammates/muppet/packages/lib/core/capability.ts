/**
 * The agent's own code: a module of ordinary typed functions, with the
 * prompt that says what it is for. Handlers and the scripts the agent writes
 * import the functions from `file` and call them like any others, so their
 * types are the compiler's to check. By convention a function takes the
 * context, or the part of it it needs, then one input object if it has any
 * input, so that it can be called the same way from a script, a handler, or
 * a command line with the input as JSON.
 */
export type Module = {
	readonly kind: "module";
	readonly name: string;
	/** One line, always shown to the agent. */
	readonly summary: string;
	/** Anything beyond the summary and the functions' own docs, e.g. when to use them. */
	readonly docs: string;
	/** The module's file, which scripts import from. */
	readonly file: string;
	/** The functions the agent is meant to use, under the names the module exports them by. */
	readonly functions: Functions;
};

export type Functions = Readonly<Record<string, (...args: never[]) => unknown>>;

/**
 * Software the agent can use that isn't its own code: an npm package from its
 * `package.json`, imported by name, or a program from its flake, run from a
 * script or a shell.
 */
export type Dependency = {
	readonly kind: "package" | "program";
	readonly name: string;
	readonly summary: string;
	readonly docs: string;
};

export type Capability = Module | Dependency;

export type Catalog = Readonly<Record<string, Capability>>;

/**
 * The exported functions of the module at `file` named by `names`, as text:
 * each one's docs and signature, read from the code so they can't drift.
 */
export type Signatures = (
	file: string,
	names: readonly string[],
) => Promise<string>;

export const module = (definition: {
	readonly name: string;
	readonly summary: string;
	readonly docs?: string;
	readonly file: string;
	readonly functions: Functions;
}): Module => ({
	kind: "module",
	name: definition.name,
	summary: definition.summary,
	docs: definition.docs ?? "",
	file: definition.file,
	functions: definition.functions,
});

export const npm = (definition: Omit<Dependency, "kind">): Dependency => ({
	kind: "package",
	...definition,
});

export const program = (definition: Omit<Dependency, "kind">): Dependency => ({
	kind: "program",
	...definition,
});

const line = (capability: Capability): string => {
	const functions =
		capability.kind === "module"
			? ` Functions: ${Object.keys(capability.functions).join(", ")}.`
			: "";
	return `- ${capability.name} (${capability.kind}): ${capability.summary}${functions}`;
};

/** The compact list the agent always sees: one line per capability. */
export const summarize = (catalog: Catalog): string =>
	Object.values(catalog).map(line).join("\n");

const body = async (
	capability: Capability,
	signatures: Signatures,
): Promise<string> => {
	if (capability.kind !== "module") return capability.docs;
	const names = Object.keys(capability.functions);
	return [
		...(capability.docs === "" ? [] : [capability.docs]),
		`import { ${names.join(", ")} } from ${JSON.stringify(capability.file)};`,
		await signatures(capability.file, names),
	].join("\n\n");
};

/** The module that lists a function by this name, if one does. */
export const moduleOf = (catalog: Catalog, name: string): Module | undefined =>
	Object.values(catalog).flatMap((capability) =>
		capability.kind === "module" && Object.hasOwn(capability.functions, name)
			? [capability]
			: [],
	)[0];

/**
 * Full docs for the named capabilities, noting any that don't exist. A name
 * may also be one function of a module, described alone with its module's
 * docs.
 */
export const describe = async (
	catalog: Catalog,
	names: readonly string[],
	signatures: Signatures,
): Promise<string> =>
	(
		await Promise.all(
			names.map(async (name) => {
				const capability = catalog[name];
				if (capability !== undefined)
					return `## ${name} (${capability.kind})\n${capability.summary}\n\n${await body(capability, signatures)}`;
				const owner = moduleOf(catalog, name);
				return owner === undefined
					? `## ${name}\nNo such capability.`
					: `## ${name} (a function of ${owner.name})\n${owner.summary}\n\n${await body({ ...owner, functions: { [name]: owner.functions[name] ?? (() => undefined) } }, signatures)}`;
			}),
		)
	).join("\n\n");
