import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
// Wrangler compiles .wasm files at bundle time via the CompiledWasm rule in wrangler.jsonc.
// We pass the pre-compiled module directly so workerd never tries to fetch it at runtime.
import wasmModule from "@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm";
import type { DocumentOp } from "../../lexical-core/ai-editing/editor/ops";
import { SANDBOX_CODE } from "./editor-sandbox-code";

const variant = newVariant(releaseSync, { wasmModule });
let _qjs: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>> | null = null;

async function qjs() {
	if (!_qjs) _qjs = await newQuickJSWASMModuleFromVariant(variant);
	return _qjs;
}

export async function runInSandbox(
	validIds: Set<string>,
	code: string,
): Promise<DocumentOp[]> {
	const QuickJS = await qjs();
	const ctx = QuickJS.newContext();
	try {
		const init = ctx.unwrapResult(
			ctx.evalCode(
				`${SANDBOX_CODE}\nconst editor = new DocumentEditor(${JSON.stringify([...validIds])});`,
			),
		);
		init.dispose();

		const run = ctx.unwrapResult(ctx.evalCode(code));
		run.dispose();

		const out = ctx.unwrapResult(
			ctx.evalCode("JSON.stringify(editor.drain())"),
		);
		const json = ctx.dump(out) as string;
		out.dispose();
		return JSON.parse(json) as DocumentOp[];
	} finally {
		ctx.dispose();
	}
}
