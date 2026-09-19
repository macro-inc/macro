export type Service = {
	name: string;
	dev: string;
	prod: string;
	local: string;
	output: string;
	orvalKey: string;
};

export const services: Service[] = [
	{
		name: "cloud-storage",
		dev: "https://dev-gateway.macro.com/dss/api-doc/openapi.json",
		prod: "https://gateway.macro.com/dss/api-doc/openapi.json",
		local: "http://localhost:8086/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-storage/",
		orvalKey: "storageService",
	},
	{
		name: "properties-service",
		dev: "https://dev-gateway.macro.com/dss/properties/api-doc/openapi.json",
		prod: "https://gateway.macro.com/dss/properties/api-doc/openapi.json",
		local: "http://localhost:8086/properties/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-properties/",
		orvalKey: "propertiesService",
	},
	{
		name: "document-cognition",
		dev: "https://document-cognition-dev.macro.com/api-doc/openapi.json",
		prod: "https://document-cognition-dev.macro.com/api-doc/openapi.json",
		local: "http://localhost:8085/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-cognition/",
		orvalKey: "cognitionService",
	},
	{
		name: "auth-service",
		dev: "https://dev-gateway.macro.com/auth/api-doc/openapi.json",
		prod: "https://gateway.macro.com/auth/api-doc/openapi.json",
		local: "http://localhost:8080/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-auth/",
		orvalKey: "authService",
	},
	{
		name: "notification-service",
		dev: "https://dev-gateway.macro.com/notification/api-doc/openapi.json",
		prod: "https://gateway.macro.com/notification/api-doc/openapi.json",
		local: "http://localhost:8089/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-notification/",
		orvalKey: "notificationService",
	},
	{
		name: "static-files",
		dev: "https://static-file-service-dev.macro.com/api/api-doc/openapi.json",
		prod: "https://static-file-service.macro.com/api/api-doc/openapi.json",
		local: "http://localhost:8094/api/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-static-files/",
		orvalKey: "staticFileService",
	},
	{
		name: "connection-gateway",
		dev: "https://dev-gateway.macro.com/connection-gateway/api-doc/openapi.json",
		prod: "https://gateway.macro.com/connection-gateway/api-doc/openapi.json",
		local: "http://localhost:8082/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-connection/",
		orvalKey: "connectionGateway",
	},
	{
		name: "contacts-service",
		dev: "https://dev-gateway.macro.com/contacts/api-doc/openapi.json",
		prod: "https://gateway.macro.com/contacts/api-doc/openapi.json",
		local: "http://localhost:8083/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-contacts/",
		orvalKey: "contactService",
	},
	{
		name: "agent-harness",
		dev: "https://dev-gateway.macro.com/agent-harness/api-doc/openapi.json",
		prod: "https://gateway.macro.com/agent-harness/api-doc/openapi.json",
		local: "http://localhost:8101/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-agent-harness/",
		orvalKey: "agentHarnessService",
	},
	{
		name: "unfurl-service",
		dev: "https://dev-gateway.macro.com/unfurl/api-doc/openapi.json",
		prod: "https://gateway.macro.com/unfurl/api-doc/openapi.json",
		local: "http://localhost:8095/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-unfurl/",
		orvalKey: "unfurlService",
	},
	{
		name: "email-service",
		dev: "https://dev-gateway.macro.com/email/api-doc/openapi.json",
		prod: "https://gateway.macro.com/email/api-doc/openapi.json",
		local: "http://localhost:8087/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-email/",
		orvalKey: "emailService",
	},
	{
		name: "search-service",
		dev: "https://search-service-dev.macro.com/api-doc/openapi.json",
		prod: "https://search-service.macro.com/api-doc/openapi.json",
		local: "http://localhost:8093/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-search/",
		orvalKey: "searchService",
	},
	{
		name: "scheduled-action",
		dev: "https://dev-gateway.macro.com/scheduled-action/api-doc/openapi.json",
		prod: "https://gateway.macro.com/scheduled-action/api-doc/openapi.json",
		local: "http://localhost:8099/api-doc/openapi.json",
		output: "../src/lib/service-clients/service-scheduled-action/",
		orvalKey: "scheduledActionService",
	},
];

export const documentCognitionBase: Service = {
	name: "document-cognition",
	dev: "https://document-cognition-dev.macro.com",
	prod: "https://document-cognition.macro.com",
	local: "http://localhost:8085",
	output: "../src/lib/service-clients/service-cognition/",
	orvalKey: "cognitionService",
};

export function serviceUrl(service: Service): string {
	const isProd = process.env.MODE === "production";
	const isLocal =
		process.env.MODE === "local" || process.env.LOCAL_BACKEND === "true";
	const schemaUrl = isLocal
		? service.local
		: isProd
			? service.prod
			: service.dev;
	console.log(`resolved schema: ${schemaUrl}`);
	return schemaUrl;
}
