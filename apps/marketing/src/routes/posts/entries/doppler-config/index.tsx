import './DopplerConfig.css';
import { Diagram, DiagramArrow, DiagramBox } from '../../PostDiagram';
import type { PostMeta } from '../../registry';

export const postMeta: PostMeta = {
  slug: 'doppler-config',
  title: 'How We Migrated Macro to Doppler',
  titleLine2: 'and Made Configuration Safer',
  seoTitle: 'How We Migrated Macro to Doppler and Made Configuration Safer',
  subtitle:
    'One source of truth for every service’s configuration, a typed loader that fails at startup instead of drifting, and CI that catches a missing value before it becomes a failed deploy.',
  date: '2026-07-12',
  description:
    'How Macro moved service configuration to Doppler: Config Sync into AWS Secrets Manager, a single APP_SECRETS_JSON injected at deploy time, typed loading through the macro_env_var and macro_config crates, and CI validation with doppler-config-rs.',
  preview:
    'Deploy fails. Dig through the logs. Find the environment variable nobody added to the infra. We got tired of that loop.',
  tags: ['macro', 'engineering'],
  category: 'Engineering',
  // Cross-post from the building-in-public push; lives at /posts, not on the homepage.
  hideFromHome: true,
  coverBrand: 'doppler',
  image: '/og/doppler-config.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Will Hutchinson', role: 'Macro Engineering' },
  ctaButtonName: 'blog_doppler_config_cta',
};

const CONFIG_EXAMPLE = `use anyhow::Context;
use database_env_vars::{DatabaseUrl, RedisUri};
pub use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use macro_middleware::auth::internal_access::InternalApiKey;

env_vars! {
    pub struct BaseUrl;
}

maybe_env_vars! {
    pub struct ContactsQueueMaxMessages;
    pub struct ContactsQueueWaitTimeSeconds;
}

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The services base url
    pub base_url: BaseUrl,
    /// port number of service
    #[macro_config_default(8080)]
    pub port: usize,
    /// The environment we are in
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// The connection URL for the Postgres database this application should use.
    pub database_url: DatabaseUrl,
    /// The Redis URI for rate limiting.
    pub redis_uri: RedisUri,
    /// The notification queue max messages per poll
    pub contacts_queue_max_messages: ContactsQueueMaxMessages,
    /// The notification queue wait time seconds
    pub contacts_queue_wait_time_seconds: ContactsQueueWaitTimeSeconds,
    /// The internal api key value.
    pub internal_api_key: InternalApiKey,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        macro_config::ConfigLoader::load::<Config>()
            .context("failed to load contacts service config")
    }

    #[cfg(test)]
    pub fn new_testing() -> Self {
        Config {
            base_url: BaseUrl::Comptime(""),
            port: 0,
            environment: Environment::Local,
            database_url: DatabaseUrl::Comptime(""),
            redis_uri: RedisUri::Comptime(""),
            contacts_queue_max_messages: ContactsQueueMaxMessages::new_unset(),
            contacts_queue_wait_time_seconds: ContactsQueueWaitTimeSeconds::new_unset(),
            internal_api_key: InternalApiKey::Comptime(""),
        }
    }
}`;

const CI_VALIDATION = `use macro_env::Environment;

mod config;

const DOPPLER_PROJECT: &str = "<project_name>";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dev = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("valid Doppler configuration");

    dev.load::<config::Config>().await?;

    let prd = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Production.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("valid Doppler configuration");

    prd.load::<config::Config>().await?;

    Ok(())
}`;

export default function DopplerConfigPost() {
  return (
    <div class="dpl-post">
      <article>
        <p class="dpl-lede">
          As Macro has grown, so has the number of services we run to deliver
          the product experience our users expect.
        </p>
        <p>
          One recurring headache has been keeping each service's configuration
          requirements synchronized with the environment variables provided to
          its container at runtime.
        </p>

        <h2>Environment desync</h2>
        <p>
          A very common pattern, and one that we originally adopted, is to use
          infrastructure as code to orchestrate all the environment variable
          values required by our services. We followed this pattern using Pulumi
          and TypeScript.
        </p>
        <p>
          It became quite easy to add a new required config value to a Rust
          service and forget to update the Pulumi infra to provide it. A typical
          flow: deploy to development, learn that the deployment had failed, and
          dig through the logs to identify the missing environment variable. The
          same failure could then happen again in production if the
          corresponding configuration change was not applied there.
        </p>
        <p>
          This caused considerable frustration among our engineers and became a
          frequent topic of discussion within the organization. I shared that
          frustration, so I decided to address the problem.
        </p>

        <h2>Introducing Doppler</h2>
        <p>
          I had used Doppler for several personal projects and appreciated how
          easy it was to use locally. Its Config Sync feature also made it
          straightforward to provide configuration values to deployed services.
        </p>
        <p>
          Alongside the frustration about infra/service environment mismatch,
          there was also growing frustration over the difficulty of setting up
          local environments with all the necessary configuration values.
          Doppler offered a solution to both problems: personal configs allow
          per-user customisation of specific fields without overriding the
          values other engineers use.
        </p>
        <p>
          With Doppler in place, we store each service's configuration values in
          a Doppler project managed through Pulumi. That gives us{' '}
          <span class="dpl-hl">
            one source of truth for both deployed services and local development
          </span>
          , making configuration easier to synchronize and update.
        </p>

        <h2>Runtime configuration</h2>
        <p>
          In this system, configuration refers to the complete set of values a
          service needs. Secrets — API keys, database credentials — are the
          sensitive subset of that configuration, while values such as ports and
          queue limits are not necessarily secret. Environment variables are the
          mechanism we use to deliver those values to a running service.
        </p>
        <p>
          For deployment, Doppler Config Sync writes the complete configuration
          to a secret in AWS Secrets Manager, even though not every value it
          contains is sensitive. At deployment time, that secret is injected
          into the service container as a single <code>APP_SECRETS_JSON</code>{' '}
          environment variable containing a JSON object.
        </p>
        <p>
          This was incompatible with our existing model, which read each value
          individually using <code>std::env::var</code>, so we adapted{' '}
          <code>macro_env_var</code> and <code>macro_config</code> to support
          the new runtime flow.
        </p>

        <h2>
          The <code>macro_env_var</code> crate
        </h2>
        <p>
          The <code>macro_env_var</code> crate provides type-safe access to
          environment variables. After some refactoring and the addition of
          custom Clippy rules, it became the only approved way to access
          environment variables in our Rust services.
        </p>
        <p>
          The updated crate looks for a value in <code>APP_SECRETS_JSON</code>{' '}
          first and falls back to the corresponding environment variable when
          the key is absent. This lets developers use Doppler to inject ordinary
          environment variables locally, while deployed services consume the
          JSON object produced by Config Sync.
        </p>

        <h2>
          The <code>macro_config</code> crate
        </h2>
        <p>
          While <code>macro_env_var</code> provides type-safe access to
          individual values, the <code>macro_config</code> crate brings those
          values together into a single typed service configuration. When{' '}
          <code>ConfigLoader</code> loads a type that derives{' '}
          <code>macro_config::MacroConfig</code>, the generated implementation
          attempts to construct every field in that configuration.
        </p>
        <p>
          Required values, optional values, and defaults are all expressed in
          the configuration's type definition, giving the service one schema
          that can be used both at runtime and by our Doppler validation in CI.
        </p>
        <p>
          For example, the following configuration uses types created by{' '}
          <code>env_vars!</code> and <code>maybe_env_vars!</code> alongside
          shared environment-variable types from other crates. Fields such as{' '}
          <code>port</code> and <code>environment</code> define defaults, while
          the remaining values are validated as the configuration is loaded.
        </p>
        <pre
          class="dpl-code"
          aria-label="A service configuration deriving MacroConfig"
        >
          {CONFIG_EXAMPLE}
        </pre>
        <p>
          Calling <code>Config::from_env()</code> gives each service a single
          startup path for loading its configuration. If{' '}
          <code>macro_config</code> cannot derive a required field because its
          value is missing or invalid, the <code>Config</code> value is not
          created. Instead the loader returns an error and{' '}
          <span class="dpl-hl">
            the service fails during startup rather than running with incomplete
            configuration
          </span>
          .
        </p>

        <h2>Validating configuration in CI</h2>
        <p>
          With runtime configuration loading in place, we still needed a
          convenient way to test every environment against the same
          configuration schema before deployment. That led to{' '}
          <a href="https://gitlab.com/hutchery/doppler-config-rs">
            <code>doppler-config-rs</code>
          </a>
          .
        </p>
        <p>
          I originally created this crate to provide runtime secrets to
          services. After we adopted Doppler Config Sync that functionality was
          no longer necessary, so the crate is now used exclusively to validate
          configuration in CI.
        </p>
        <p>
          It is straightforward to use: provide a struct that implements{' '}
          <code>serde::Deserialize</code>, a Doppler project name, and a
          configuration slug. The crate then loads the Doppler values and
          deserializes them into that struct. The following example shows how we
          validate a service's development and production configurations.
        </p>
        <pre
          class="dpl-code"
          aria-label="Validating development and production configs in CI"
        >
          {CI_VALIDATION}
        </pre>
        <p>
          By loading both environments into the service's <code>Config</code>{' '}
          type, CI catches missing values and deserialization errors before the
          service is deployed.
        </p>

        <h2>End-to-end configuration flow</h2>
        <Diagram
          title="From Pulumi to a running service"
          alt="Pulumi manages the Doppler project, Doppler Config Sync writes the values to an AWS Secrets Manager secret, the secret is injected at deploy time as APP_SECRETS_JSON, and the service loads it into a typed Config at startup. In parallel, CI loads the same Doppler values into the same Config type."
          caption="The same typed Config is the target in CI and at startup, so a missing value fails a check instead of a deploy."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Pulumi"
              items={['Infra as code', 'Manages the', 'Doppler project']}
            />
            <DiagramArrow />
            <DiagramBox
              title="Doppler"
              items={['Config Sync', 'Personal configs', 'Local + deployed']}
            />
            <DiagramArrow />
            <DiagramBox
              title="AWS Secrets Manager"
              items={['One secret', 'Full configuration', 'Injected at deploy']}
            />
            <DiagramArrow />
            <DiagramBox
              title="Service startup"
              items={['APP_SECRETS_JSON', 'ConfigLoader', 'Typed Config']}
            />
          </div>
          <div class="pdg-footnote">
            <DiagramBox
              dashed
              title="CI"
              note="doppler-config-rs loads dev and prod into the same Config type, before any of this runs"
            />
          </div>
        </Diagram>
        <p>The complete flow is:</p>
        <ol class="dpl-list">
          <li>
            Pulumi manages the Doppler project that contains a service's
            configuration values.
          </li>
          <li>
            Doppler Config Sync writes those values to a secret in AWS Secrets
            Manager.
          </li>
          <li>
            At deployment time, the secret is injected into the service
            container as the <code>APP_SECRETS_JSON</code> environment variable.
          </li>
          <li>
            When the service starts, <code>Config::from_env()</code> invokes{' '}
            <code>ConfigLoader</code>, which uses the generated{' '}
            <code>MacroConfig</code> implementation to construct every field in{' '}
            <code>Config</code>.
          </li>
          <li>
            For fields backed by <code>macro_env_var</code>, the crate reads the
            corresponding value from <code>APP_SECRETS_JSON</code>. If the key
            is not present there, it falls back to the individual environment
            variable used during local development.
          </li>
          <li>
            Defaults and optional values are handled according to the{' '}
            <code>Config</code> definition. If any required value is missing or
            invalid, <code>macro_config</code> cannot create the{' '}
            <code>Config</code>, and service startup fails with an error.
          </li>
          <li>
            In CI, <code>doppler-config-rs</code> loads the development and
            production values from Doppler into the same <code>Config</code>{' '}
            type, catching missing or invalid configuration before deployment.
          </li>
        </ol>

        <h2>Conclusion</h2>
        <p>
          Yes, we could have built this system with SOPS, AWS SSM, or several
          other providers, each with its own tradeoffs. We chose Doppler because
          of its easy personal configuration setup and our team's prior
          familiarity with it.
        </p>
        <p>
          In practice, missing or malformed required values now fail CI when the
          Doppler configuration is loaded into the service's typed{' '}
          <code>Config</code>, rather than first appearing as failed
          deployments. That gives our engineers a clearer local setup and
          earlier feedback on configuration changes, without inventing a
          separate validation schema.
        </p>
      </article>
    </div>
  );
}
