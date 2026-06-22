import yargs from "yargs";
import { hideBin } from "yargs/helpers";

/** Parse a wss-url positional plus any extra options. Usage: `args("$0 <wss-url> [extra]", y => y.option(...))` */
export async function args<T extends Record<string, unknown>>(
	usage: string,
	extend?: (y: ReturnType<typeof yargs>) => ReturnType<typeof yargs>,
): Promise<{ wssUrl: string } & T> {
	let y = yargs(hideBin(process.argv)).usage(usage).help();
	if (extend) y = extend(y);
	const argv = await y.parse();
	const wssUrl = argv._[0] as string | undefined;
	if (!wssUrl) {
		y.showHelp();
		process.exit(1);
	}
	return { ...(argv as unknown as T), wssUrl };
}

export type ParsedWssUrl = {
	documentId: string;
	token: string;
};

/** Extract documentId and token from a sync wss URL. */
export function parseWssUrl(wssUrl: string): ParsedWssUrl {
	const url = new URL(wssUrl);
	const documentId = url.pathname.split("/").at(-2);
	const token = url.searchParams.get("token");
	if (!documentId || !token) {
		console.error("Could not parse documentId or token from WSS URL");
		process.exit(1);
	}
	return { documentId, token };
}
