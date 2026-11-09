import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const targets = [
	{ rust: "aarch64-linux-android", clang: "aarch64-linux-android" },
	{ rust: "x86_64-linux-android", clang: "x86_64-linux-android" },
	{ rust: "armv7-linux-androideabi", clang: "armv7a-linux-androideabi" },
	{ rust: "i686-linux-android", clang: "i686-linux-android" },
];
const requested = process.argv[2] ?? "x86_64-linux-android";
const target = targets.find((value) => value.rust === requested);
if (!target) throw new Error(`Unsupported Android target: ${requested}`);
const ndk = process.env.NDK_HOME;
if (!ndk) throw new Error("NDK_HOME must point to the intended Android NDK");
const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
const tools = join(ndk, "toolchains/llvm/prebuilt", host, "bin");
const compiler = join(tools, `${target.clang}24-clang`);
if (!existsSync(compiler))
	throw new Error("Android API 24 compiler is missing");
const cargoTarget = target.rust.replaceAll("-", "_").toUpperCase();
const nativeTarget = target.rust.replaceAll("-", "_");
execFileSync(
	"cargo",
	["build", "-p", "document_session_ffi", "--target", target.rust, "-j2"],
	{
		cwd: root,
		stdio: "inherit",
		env: {
			...process.env,
			TMPDIR: "/home/wolf/tmp",
			CARGO_BUILD_JOBS: "2",
			CARGO_TARGET_DIR: join(root, "target"),
			[`CARGO_TARGET_${cargoTarget}_LINKER`]: compiler,
			[`CC_${nativeTarget}`]: compiler,
			[`CXX_${nativeTarget}`]: `${compiler}++`,
			[`AR_${nativeTarget}`]: join(tools, "llvm-ar"),
		},
	},
);
