import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const crate = join(root, "crates/client/document_session_ffi");
const environment = {
	...process.env,
	TMPDIR: "/home/wolf/tmp",
	CARGO_BUILD_JOBS: "2",
};
const run = (args: string[]) =>
	execFileSync("cargo", args, {
		cwd: root,
		env: environment,
		stdio: "inherit",
	});
run(["build", "-p", "document_session_ffi", "-j2"]);
const check = process.argv.includes("--check");
const output = check
	? mkdtempSync(join(environment.TMPDIR, "document-session-bindings-"))
	: join(crate, "bindings");
try {
	const extension = process.platform === "darwin" ? "dylib" : "so";
	run([
		"run",
		"-p",
		"document_session_ffi",
		"--features",
		"bindgen",
		"--bin",
		"document-session-bindgen",
		"-j2",
		"--",
		"generate",
		"--library",
		join(root, `target/debug/libdocument_session_ffi.${extension}`),
		"--language",
		"swift",
		"--language",
		"kotlin",
		"--config",
		join(crate, "uniffi.toml"),
		"--out-dir",
		output,
		"--no-format",
	]);
	if (check) {
		const files = (directory: string): string[] =>
			readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory()
					? files(join(directory, entry.name))
					: [join(directory, entry.name)],
			);
		const expected = files(output)
			.map((file) => file.slice(output.length + 1))
			.sort();
		const actual = files(join(crate, "bindings"))
			.map((file) => file.slice(join(crate, "bindings").length + 1))
			.sort();
		if (JSON.stringify(actual) !== JSON.stringify(expected))
			throw new Error("Native binding file set is stale");
		for (const file of files(output)) {
			const relative = file.slice(output.length + 1);
			if (
				!readFileSync(file).equals(
					readFileSync(join(crate, "bindings", relative)),
				)
			)
				throw new Error(`Stale native binding: ${relative}`);
		}
	}
} finally {
	if (check) rmSync(output, { recursive: true });
}
