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

/**
 * The property a member access names: `create` in `macro.create` and in
 * `macro["create"]`, but nothing for `macro[name]`, whose value isn't known.
 */
function propertyName(node: Deno.lint.MemberExpression): string | undefined {
	if (!node.computed)
		return node.property.type === "Identifier" ? node.property.name : undefined;
	return node.property.type === "Literal" &&
		typeof node.property.value === "string"
		? node.property.value
		: undefined;
}

/** The key a destructured property takes, such as `readTextFile` in `{ readTextFile: read }`. */
function keyName(property: Deno.lint.Property): string | undefined {
	if (!property.computed && property.key.type === "Identifier")
		return property.key.name;
	return property.key.type === "Literal" &&
		typeof property.key.value === "string"
		? property.key.value
		: undefined;
}

/** `Deno` APIs that read files, which would only find the sandbox's bundle. */
const SANDBOX_READS =
	/^(readFile|readTextFile|readDir|readLink|open|stat|lstat|realPath)(Sync)?$/;

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
					// `const { readTextFile } = Deno` takes the reader out first.
					VariableDeclarator(node) {
						if (
							node.id.type !== "ObjectPattern" ||
							node.init?.type !== "Identifier" ||
							node.init.name !== "Deno"
						)
							return;
						for (const property of node.id.properties) {
							if (property.type !== "Property") continue;
							const name = keyName(property);
							if (name !== undefined && SANDBOX_READS.test(name)) {
								context.report({ node: property, message: `Deno.${name}` });
							}
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
						const owner = callee.object.name;
						if (
							name !== undefined &&
							Object.hasOwn(REFLECTION, owner) &&
							REFLECTION[owner]?.includes(name)
						) {
							context.report({
								node,
								message: `${owner}.${name}`,
							});
						}
					},
				};
			},
		},
	},
};

export default plugin;
