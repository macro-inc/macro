import * as path from "node:path";
import { services } from "../services";

const serviceClientDirectories = {
	auth: "service-auth",
	cognition: "service-cognition",
	connection: "service-connection",
	contacts: "service-contacts",
	email: "service-email",
	notification: "service-notification",
	properties: "service-properties",
	"scheduled-action": "service-scheduled-action",
	search: "service-search",
	"static-files": "service-static-files",
	storage: "service-storage",
	unfurl: "service-unfurl",
	"agent-proxy": "service-agent-proxy",
} satisfies Record<(typeof services)[number], string>;

const serviceClientsDirectory = path.resolve(
	import.meta.dirname,
	"../../../apps/web/src/lib/service-clients",
);
const specsDirectory = path.resolve(import.meta.dirname, "../specs");

for (const service of services) {
	const source = path.join(
		serviceClientsDirectory,
		serviceClientDirectories[service],
		"openapi.json",
	);
	const destination = path.join(specsDirectory, `${service}.json`);

	await Bun.write(destination, Bun.file(source));
	console.log(`Synced ${service}`);
}
