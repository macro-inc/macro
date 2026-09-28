import * as datadog from '@pulumi/datadog';

// The only external probe of the product. It owns its own alert monitor
// (19726068, "Macro App is Down") through `optionsList.monitorName` — that
// monitor is not a separate resource and must never be imported as one.
//
// `optionsList.monitorOptions` in the provider only models
// notificationPresetName / escalationMessage / renotify*. The live test also
// carries onMissingData, notifyAudit, newHostDelay and includeTags on its
// monitor; those are Datadog's synthetics defaults and are not expressible
// here.
//
// `message` below is Datadog's default synthetics notification template,
// reproduced verbatim from the live test. Backticks are escaped for the
// template literal; the rendered text is unchanged.
export const appWelcomeHealthCheck = new datadog.SyntheticsTest(
  'app-welcome-health-check',
  {
    name: 'Health check on macro.com/app/welcome',
    type: 'api',
    subtype: 'http',
    status: 'live',
    tags: ['prod', 'env:prod'],
    locations: ['aws:ca-central-1', 'aws:us-east-1', 'gcp:us-west2'],
    requestDefinition: {
      method: 'GET',
      url: 'https://macro.com/app/welcome',
    },
    assertions: [
      { type: 'responseTime', operator: 'lessThan', target: '3000' },
      { type: 'statusCode', operator: 'is', target: '200' },
      {
        type: 'header',
        property: 'content-type',
        operator: 'is',
        target: 'text/html',
      },
    ],
    optionsList: {
      tickEvery: 300,
      minFailureDuration: 300,
      minLocationFailed: 1,
      httpVersion: 'any',
      retry: { count: 0, interval: 300 },
      monitorName: 'Macro App is Down',
      monitorOptions: { notificationPresetName: 'show_all' },
    },
    message: `{{! Test result details }}

@slack-holy-shit-alarms  @hutch@macro.com @teo@macro.com

Your test {{#is_alert}}failed{{else}}recovered{{/is_alert}} after running for {{eval "synthetics.attributes.result.duration/1000" }}s on the {{#if synthetics.attributes.location.privateLocation}}Private{{else}}Managed{{/if}} Location {{synthetics.attributes.location.id}}.

{{! If alert, provide details about the failure }}
{{#is_alert}}{{#is_exact_match "synthetics.attributes.result.failure.code" "INCORRECT_ASSERTION"}}
{{! Test failed due to failed assertions, list them }}
# Failed assertions
{{#each synthetics.attributes.result.assertions}}{{#unless valid}}
* Assertion \`{{type}}\` \`{{operator}}\`: expected \`{{{expected}}}\`, found \`{{{actual}}}\`
{{/unless}}{{/each}}
{{else}}
{{! Test failed for another reason, show the error }}
# Error message
The test failed with the error \`{{{synthetics.attributes.result.failure.message}}}\` (\`{{{synthetics.attributes.result.failure.code}}}\`).
{{/is_exact_match}}{{/is_alert}}

{{! HTTP request and response details }}
{{#with synthetics.attributes.result}}
We made a \`{{request.method}}\` request to {{#if request.service}}the \`{{request.service}}\` service located at {{/if}}\`{{{request.url}}}\` and received an HTTP {{response.httpVersion}} response with a {{response.statusCode}} status code.
{{/with}}

{{! HTTP Timings }}
{{#with synthetics.attributes.result.timings}}
# Timings
{{#if redirect}}* Redirect: {{redirect}}
{{/if}}* DNS: {{dns}}
* TCP: {{tcp}}
{{#if authentication}}* Authentication: {{authentication}}
{{/if}}{{#if ssl}}* SSL: {{ssl}}
{{/if}}* FirstByte: {{firstByte}}
* Download: {{download}}
{{/with}}

{{! Display config variables if any }}
{{#if synthetics.attributes.result.variables.config}}
# Config Variables
The test used the following variables:
{{#each synthetics.attributes.result.variables.config}}
* **Name:** \`{{name}}\`
Type: \`{{type}}\`
Value: {{#if secure}}*Obfuscated (value hidden)*{{else}}\`{{{value}}}\`{{/if}}{{/each}}
{{/if}}

{{! Display extracted variables, available only if the test is successful }}
{{#if synthetics.attributes.result.variables.extracted}}
# Extracted Variables
The test successfully extracted the following variables:
{{#each synthetics.attributes.result.variables.extracted}}
* **Name:** \`{{name}}\` (Global Variable ID: \`{{id}}\`)
Value: {{#if secure}}*Obfuscated (value hidden)*{{else}}\`{{{val}}}\`{{/if}}{{/each}}
{{/if}}`,
  },
  { protect: true }
);
