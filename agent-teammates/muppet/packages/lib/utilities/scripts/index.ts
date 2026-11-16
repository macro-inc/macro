/**
 * Type-checking for the scripts an agent writes, and the `load` and
 * `signatures` a runtime needs, built on it.
 *
 * `checker` keeps one TypeScript language service for the life of the
 * process, so a script costs only its own check once the agent's code has
 * been read the first time. `loader` checks a script, with a second file
 * that holds its `main` to the agent's context, before writing and importing
 * it:
 *
 *     const check = checker({ typescript, config });
 *     simple({ systemPrompt, load: loader({ ... }), signatures: async (file, names) => check.signatures(file, names) })
 */
import { dirname, join } from "node:path";
import type typescript from "typescript";
import type { Exported, Load } from "../../core/code.ts";

export type Checker = {
	/**
	 * The type errors in these files, given as their text by path, or
	 * undefined if there are none. They are checked as if they were on disk at
	 * those paths, though they need not be.
	 */
	readonly check: (
		files: Readonly<Record<string, string>>,
	) => string | undefined;
	/** The docs and signature of each of `names`, as the module at `file` exports them. */
	readonly signatures: (file: string, names: readonly string[]) => string;
};

/**
 * A checker using the compiler options of the tsconfig at `config`. Files
 * are read through `typescript.sys` as they are needed, and read again when
 * they change.
 */
export const checker = ({
	typescript: ts,
	config,
}: {
	/** The `typescript` module, injected. */
	readonly typescript: typeof typescript;
	/** The path of the tsconfig.json whose compiler options scripts are checked with. */
	readonly config: string;
}): Checker => {
	const directory = dirname(config);
	const read = ts.readConfigFile(config, ts.sys.readFile);
	if (read.error !== undefined)
		throw new Error(
			ts.flattenDiagnosticMessageText(read.error.messageText, "\n"),
		);
	// Checking emits nothing and belongs to no project, whatever the config builds.
	const options: typescript.CompilerOptions = {
		...ts.parseJsonConfigFileContent(read.config, ts.sys, directory).options,
		composite: false,
		incremental: false,
		emitDeclarationOnly: false,
		noEmit: true,
	};

	// The files being checked now: only these are roots, so the program is
	// them and whatever they import.
	const roots = new Map<string, string | undefined>();
	let generation = 0;

	const host: typescript.LanguageServiceHost = {
		getCompilationSettings: () => options,
		getCurrentDirectory: () => directory,
		getDefaultLibFileName: ts.getDefaultLibFilePath,
		getScriptFileNames: () => [...roots.keys()],
		getScriptVersion: (file) =>
			roots.get(file) === undefined
				? String(ts.sys.getModifiedTime?.(file)?.getTime() ?? 0)
				: `checked-${generation}`,
		getScriptSnapshot: (file) => {
			const text = roots.get(file) ?? ts.sys.readFile(file);
			return text === undefined
				? undefined
				: ts.ScriptSnapshot.fromString(text);
		},
		fileExists: (file) => roots.has(file) || ts.sys.fileExists(file),
		readFile: (file, encoding) =>
			roots.get(file) ?? ts.sys.readFile(file, encoding),
		readDirectory: ts.sys.readDirectory,
		// A file being checked may be in a directory that doesn't exist yet.
		directoryExists: (path) =>
			[...roots.keys()].some((file) => dirname(file) === path) ||
			ts.sys.directoryExists(path),
		getDirectories: ts.sys.getDirectories,
		realpath: ts.sys.realpath,
	};
	const service = ts.createLanguageService(host, ts.createDocumentRegistry());

	const format: typescript.FormatDiagnosticsHost = {
		getCanonicalFileName: (file) => file,
		getCurrentDirectory: () => directory,
		getNewLine: () => "\n",
	};

	/** Makes `files` the program's roots for as long as `use` takes. */
	const rooted = <Result>(
		files: Readonly<Record<string, string | undefined>>,
		use: () => Result,
	): Result => {
		generation += 1;
		roots.clear();
		for (const [file, text] of Object.entries(files)) roots.set(file, text);
		try {
			return use();
		} finally {
			roots.clear();
		}
	};

	/** A type written with this is derived from a value, and says nothing until expanded. */
	const derived = "typeof ";

	/** A function's return type as its author wrote it, if they did. */
	const returns = (call: typescript.Signature): string | undefined =>
		call.declaration !== undefined && !ts.isJSDocSignature(call.declaration)
			? call.declaration.type?.getText()
			: undefined;

	const signature = (
		checks: typescript.TypeChecker,
		symbol: typescript.Symbol,
		name: string,
	): string => {
		const declaration = symbol.valueDeclaration;
		const type =
			declaration === undefined
				? checks.getTypeOfSymbol(symbol)
				: checks.getTypeOfSymbolAtLocation(symbol, declaration);
		const flags =
			ts.TypeFormatFlags.NoTruncation |
			ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
		const [call] = type.getCallSignatures();
		const text =
			call === undefined
				? `${name}: ${checks.typeToString(type, declaration, flags)}`
				: `${name}(${call.parameters
						.map((parameter) => {
							const declared = parameter.valueDeclaration;
							// A destructured parameter has no name of its own: show it as written.
							const shown =
								declared !== undefined && ts.isParameter(declared)
									? declared.name.getText()
									: parameter.name;
							const optional =
								declared !== undefined &&
								ts.isParameter(declared) &&
								(declared.questionToken !== undefined ||
									declared.initializer !== undefined)
									? "?"
									: "";
							// The type as written says more than its expansion, e.g. `Context`,
							// unless it is derived from a value, e.g. `z.input<typeof Schema>`.
							const annotation =
								declared !== undefined && ts.isParameter(declared)
									? declared.type?.getText()
									: undefined;
							const written =
								annotation?.includes(derived) === true ? undefined : annotation;
							const of =
								declared === undefined
									? checks.getTypeOfSymbol(parameter)
									: checks.getTypeOfSymbolAtLocation(parameter, declared);
							return `${shown}${optional}: ${written ?? checks.typeToString(of, declared, flags)}`;
						})
						.join(
							", ",
						)}): ${returns(call) ?? checks.typeToString(call.getReturnType(), declaration, flags)}`;
		const docs = ts.displayPartsToString(
			symbol.getDocumentationComment(checks),
		);
		return docs === "" ? text : `/** ${docs} */\n${text}`;
	};

	return {
		check: (files) =>
			rooted(files, () => {
				const found = Object.keys(files).flatMap((file) => [
					...service.getSyntacticDiagnostics(file),
					...service.getSemanticDiagnostics(file),
				]);
				return found.length === 0
					? undefined
					: ts.formatDiagnostics(found, format).trimEnd();
			}),

		signatures: (file, names) =>
			rooted({ [file]: undefined }, () => {
				const program = service.getProgram();
				const source = program?.getSourceFile(file);
				if (program === undefined || source === undefined)
					return `(${file} could not be read)`;
				const checks = program.getTypeChecker();
				const module = checks.getSymbolAtLocation(source);
				const exported = new Map(
					(module === undefined ? [] : checks.getExportsOfModule(module)).map(
						(symbol) => [symbol.name, symbol] as const,
					),
				);
				return names
					.map((name) => {
						const symbol = exported.get(name);
						if (symbol === undefined)
							return `${name}: (not exported by ${file})`;
						return signature(
							checks,
							symbol.flags & ts.SymbolFlags.Alias
								? checks.getAliasedSymbol(symbol)
								: symbol,
							name,
						);
					})
					.join("\n\n");
			}),
	};
};

/**
 * A `Load` that type-checks each script before running it. The script is
 * checked as the file it is about to be, beside a second file that assigns
 * its `main` to a function of `script`, the agent's `Script` type: so a
 * script whose `main` expects anything else is rejected too. Only a script
 * that passes is written, under a fresh name so the module cache never hands
 * back an old one, imported, and removed.
 */
export const loader =
	({
		directory,
		script,
		check,
		id,
		write,
		remove,
		load,
	}: {
		/** Where scripts are written: inside the agent's repository, so they can import its packages. */
		readonly directory: string;
		/** The agent's `Script` type, which every script's `main` must accept. */
		readonly script: Exported;
		readonly check: (
			files: Readonly<Record<string, string>>,
		) => Promise<string | undefined>;
		/** A name no script has had before. */
		readonly id: () => string;
		readonly write: (path: string, text: string) => Promise<void>;
		readonly remove: (path: string) => Promise<void>;
		/** Imports the module at a path. */
		readonly load: (path: string) => Promise<unknown>;
	}): Load =>
	async (source) => {
		const name = id();
		const path = join(directory, `${name}.ts`);
		const errors = await check({
			[path]: source,
			[join(directory, `${name}.main.ts`)]: [
				`import type { ${script.name} as Script } from ${JSON.stringify(script.file)};`,
				`import { main } from ${JSON.stringify(path)};`,
				"export const checked: (script: Script) => unknown = main;",
			].join("\n"),
		});
		if (errors !== undefined) return { kind: "rejected", errors };
		await write(path, source);
		try {
			return { kind: "loaded", module: await load(path) };
		} finally {
			await remove(path);
		}
	};
