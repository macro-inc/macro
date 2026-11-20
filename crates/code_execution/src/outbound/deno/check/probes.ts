// Lint rules for the ways a program learns the SDK by probing it instead of
// reading its documentation. `deno lint` loads this plugin beside the type
// check; the checker decides which findings refuse a program.

/** Whether `node` is a property or call chain rooted at `macro` (`macro.tasks.create`). */
function fromMacro(node: Deno.lint.Node): boolean {
	let current = node;
	while (
		current.type === "MemberExpression" ||
		current.type === "CallExpression"
	) {
		current =
			current.type === "MemberExpression" ? current.object : current.callee;
	}
	return current.type === "Identifier" && current.name === "macro";
}

/** The name of a non-computed property access, such as `create` in `macro.create`. */
function propertyName(node: Deno.lint.MemberExpression): string | undefined {
	return node.property.type === "Identifier" ? node.property.name : undefined;
}

/** `Deno` APIs that read files, which would only find the sandbox's bundle. */
const SANDBOX_READS = /^(read|open|stat|lstat|realPath)/;

/** Reflection that lists an object's members instead of its documentation. */
const REFLECTION: Record<string, readonly string[]> = {
	Object: [
		"getPrototypeOf",
		"getOwnPropertyNames",
		"getOwnPropertyDescriptors",
	],
	Reflect: ["ownKeys", "getPrototypeOf"],
};

const plugin: Deno.lint.Plugin = {
	name: "macro",
	rules: {
		"no-sandbox-read": {
			create(context) {
				return {
					MemberExpression(node) {
						const name = propertyName(node);
						if (
							node.object.type === "Identifier" &&
							node.object.name === "Deno" &&
							name !== undefined &&
							SANDBOX_READS.test(name)
						) {
							context.report({ node, message: `Deno.${name}` });
						}
					},
				};
			},
		},
		"no-sdk-source": {
			create(context) {
				return {
					CallExpression(node) {
						const callee = node.callee;
						if (
							callee.type === "MemberExpression" &&
							propertyName(callee) === "toString" &&
							fromMacro(callee.object)
						) {
							context.report({ node, message: "toString() on the SDK" });
						}
					},
				};
			},
		},
		"no-reflection": {
			create(context) {
				return {
					CallExpression(node) {
						const callee = node.callee;
						if (
							callee.type !== "MemberExpression" ||
							callee.object.type !== "Identifier"
						)
							return;
						const name = propertyName(callee);
						if (
							name !== undefined &&
							(REFLECTION[callee.object.name] ?? []).includes(name)
						) {
							context.report({
								node,
								message: `${callee.object.name}.${name}`,
							});
						}
					},
				};
			},
		},
	},
};

export default plugin;
