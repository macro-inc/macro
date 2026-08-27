//! Environment layering (lowest → highest precedence):
//!   - Local only: the [`local_env::LocalEnv`] boot stubs — deterministic
//!     placeholders that satisfy service config loaders on a `--no-doppler`
//!     stack. Doppler overrides them, so real integration values always win.
//!   - Doppler (`lcl_personal`/`dev_personal`) — the integration/secret config
//!     services require.
//!   - Local only: the typed [`local_env::LocalEnv`] overlaid on top —
//!     code is the AUTHORITATIVE source for local plumbing + the fixed FusionAuth
//!     identity (it wins over Doppler; the deleted defaults.env was the reverse,
//!     a fallback Doppler overrode).
//!   - `--env-file`  <  process env (existing keys only).
//!   - Dev only: overrides (pin env/project, strip local endpoints, real AWS creds).
//!
//! The merged map is written to a per-instance generated env file consumed by
//! docker compose both for `${VAR}` interpolation (`--env-file`) and for
//! injection into containers (via the `MACRO_ENV_FILE` indirection in the
//! `x-common-env` anchor).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use super::instance::Instance;
use super::{Mode, local_env};

#[cfg(test)]
mod test;

/// The fully resolved environment for a run.
pub struct ResolvedEnv {
    pub merged: BTreeMap<String, String>,
    pub doppler_used: bool,
    pub env_file: Option<PathBuf>,
    pub generated_path: PathBuf,
}

/// Resolve and materialize the environment for `mode`/`instance`.
// The process-env layer reads the host environment directly (xtask is tooling,
// not a service reading APP_SECRETS_JSON).
#[allow(clippy::disallowed_methods)]
pub fn resolve(
    mode: Mode,
    instance: &Instance,
    no_doppler: bool,
    env_file: Option<&Path>,
    static_frontend: bool,
    egress_public_url: Option<&str>,
) -> Result<ResolvedEnv> {
    // Base = Doppler (`lcl_personal`/`dev_personal`); it supplies the
    // integration/secret config services require. For local we then overlay the
    // typed `LocalEnv` ON TOP, so code is the AUTHORITATIVE source for local
    // plumbing + the fixed FusionAuth identity (it wins over whatever Doppler
    // has — unlike the old defaults.env, which Doppler overrode). Dev keeps
    // Doppler as-is.
    let spec = mode.spec();
    let local = spec.overlay_local_env.then(|| {
        local_env::LocalEnv::for_instance(mode, instance, static_frontend, egress_public_url)
    });
    let mut env = BTreeMap::new();
    // Boot stubs go in FIRST so Doppler overrides them: they only exist to keep
    // a `--no-doppler` stack's config loaders satisfied, never to replace a
    // real integration value a developer's Doppler config supplies.
    if let Some(local) = &local {
        env.extend(local.boot_stub_env());
    }
    let doppler_used = if no_doppler {
        false
    } else {
        pull_doppler(spec.doppler_config, &mut env)?
    };
    if let Some(local) = &local {
        for (k, v) in local.to_env() {
            env.insert(k, v);
        }
        // Opt-in local trace export: point services at the local OTLP collector
        // (docker-network alias `otel-collector`) only when one answers on the
        // OTLP HTTP port, so services don't spam export errors when none is
        // running. Both viewers bind 4318 — Jaeger (compose profile `jaeger`)
        // and the Datadog agent (profile `datadog`) — so (re)start the stack
        // after starting one to pick up tracing.
        if super::summary::port_open(4318) {
            env.insert(
                "OTEL_EXPORTER_OTLP_ENDPOINT".into(),
                "http://otel-collector:4317".into(),
            );
        }
    }

    // `--env-file` overlay (the only dotenv we still parse).
    if let Some(file) = env_file {
        load_dotenv_into(file, &mut env)
            .with_context(|| format!("loading --env-file {}", file.display()))?;
    }

    // Process env — override only keys already present, so a developer can
    // `FOO=bar just run_local` without dumping their whole environment in.
    // Never let the Nix shell's localhost SQLx default through: run-dev needs
    // Doppler's shared-dev database URL, and local injects this map into
    // containers, where localhost cannot reach postgres.
    for key in env.keys().cloned().collect::<Vec<_>>() {
        if let Ok(v) = std::env::var(&key)
            && should_overlay_process_env(&key, &v)
        {
            env.insert(key, v);
        }
    }

    // Remote-AWS modes (dev): pin ENVIRONMENT/project, strip any leaked local
    // endpoints, and resolve the developer's real AWS credentials (incl. session
    // token) over the dev_personal placeholders — the process-env layer can't add
    // a key that wasn't already present. (Local owns all of this in `LocalEnv`.)
    if spec.uses_remote_aws {
        apply_dev_overrides(instance, &mut env);
        pull_aws_credentials(&mut env);
    }

    let generated_path = instance.ensure_artifact_dir()?.join("local.generated.env");
    write_dotenv(&generated_path, &env)
        .with_context(|| format!("writing {}", generated_path.display()))?;

    Ok(ResolvedEnv {
        merged: env,
        doppler_used,
        env_file: env_file.map(Path::to_path_buf),
        generated_path,
    })
}

fn should_overlay_process_env(key: &str, value: &str) -> bool {
    !(key == "DATABASE_URL" && is_local_database_url(value))
}

pub(super) fn is_local_database_url(value: &str) -> bool {
    value.contains("@postgres:") || value.contains("localhost")
}

/// Dev-only overrides: pin the environment + project name, and strip any local
/// infra endpoints that leaked in (from `--env-file`/process env) so services
/// use real dev resources. Local's identity/ports/secrets are owned entirely by
/// [`local_env::LocalEnv`], so there is no local arm here.
fn apply_dev_overrides(instance: &Instance, env: &mut BTreeMap<String, String>) {
    env.insert(
        "ENVIRONMENT".to_string(),
        Mode::Dev.environment_var().to_string(),
    );
    env.insert(
        "COMPOSE_PROJECT_NAME".to_string(),
        instance.project_name().to_string(),
    );
    // run-dev must not point at local infra.
    env.remove("LOCAL_AWS_URL");
    env.remove("SMTP_HOST");
    env.remove("SMTP_PORT");
}

/// Resolve the developer's real AWS credentials for dev via the AWS CLI's
/// credential chain (env, named profile / `AWS_PROFILE`, or SSO) and inject the
/// `AWS_*` vars — crucially including `AWS_SESSION_TOKEN` for temporary/SSO
/// creds. Non-fatal: warns loudly if it can't, since the services would then
/// fail every AWS call with an invalid-token error.
fn pull_aws_credentials(env: &mut BTreeMap<String, String>) {
    let output = Command::new("aws")
        .args([
            "configure",
            "export-credentials",
            "--format",
            "env-no-export",
        ])
        .output();
    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => {
            eprintln!(
                "warning: could not resolve AWS credentials for dev. Log in (e.g. `aws sso login`, \
                 set `AWS_PROFILE`) so `aws configure export-credentials` works — otherwise the \
                 services will fail AWS calls with an invalid-token error."
            );
            return;
        }
    };
    let mut found = false;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim();
            if k.starts_with("AWS_") {
                env.insert(k.to_string(), v.trim().to_string());
                found = true;
            }
        }
    }
    if !found {
        eprintln!(
            "warning: `aws configure export-credentials` returned no AWS_* credentials for dev."
        );
    }
}

/// Pull Doppler secrets as a flat env overlay (mirrors the old
/// `just get_environment`). Two modes:
///
/// - `DOPPLER_TOKEN` in the process env (CI, Cloud agents) is a
///   config-scoped service token: download WITHOUT `--project`/`--config` (the
///   token pins them), and treat failure as fatal — whoever provisioned the
///   token explicitly asked for these secrets, so proceeding without them
///   would just move the breakage into the services.
/// - Otherwise pull the named `local`-project config via the developer's
///   `doppler login`. Non-fatal: if Doppler is unavailable in local mode we
///   proceed on defaults + env-file.
///
/// Returns whether secrets were loaded.
// xtask is host tooling, not a service reading APP_SECRETS_JSON, so reading the
// process environment directly is correct here.
#[allow(clippy::disallowed_methods)]
fn pull_doppler(config: &str, env: &mut BTreeMap<String, String>) -> Result<bool> {
    let token_scoped = std::env::var("DOPPLER_TOKEN").is_ok_and(|v| !v.is_empty());
    let mut cmd = Command::new("doppler");
    cmd.args(["secrets", "download"]);
    if !token_scoped {
        cmd.args(["--project", "local", "--config", config]);
    }
    cmd.args(["--format", "json", "--no-file"]);
    let output = cmd.output();
    let output = match output {
        Ok(o) if o.status.success() => o,
        Ok(o) if token_scoped => bail!(
            "doppler secrets download failed with DOPPLER_TOKEN set:\n{}",
            String::from_utf8_lossy(&o.stderr).trim_end()
        ),
        Err(e) if token_scoped => {
            return Err(anyhow::Error::from(e))
                .context("running doppler with DOPPLER_TOKEN set (is the doppler CLI installed?)");
        }
        _ => return Ok(false),
    };
    let json: BTreeMap<String, serde_json::Value> =
        serde_json::from_slice(&output.stdout).context("parsing doppler json")?;
    for (k, v) in json {
        let value = match v {
            serde_json::Value::String(s) => s.trim_matches(['\r', '\n']).to_string(),
            other => other.to_string(),
        };
        env.insert(k, value);
    }
    Ok(true)
}

/// Parse a user-provided `--env-file` into `env` via `dotenvy` (the maintained
/// dotenv crate) — handles comments, quoting, and `export ` prefixes so we don't
/// hand-roll a parser. Later keys win, matching our overlay semantics.
fn load_dotenv_into(path: &Path, env: &mut BTreeMap<String, String>) -> Result<()> {
    for item in dotenvy::from_path_iter(path)
        .with_context(|| format!("reading env file {}", path.display()))?
    {
        let (key, value) = item.with_context(|| format!("parsing env file {}", path.display()))?;
        env.insert(key, value);
    }
    Ok(())
}

/// Write the merged map as a docker-compose `env_file`. This is an *emitter*, not
/// a dotenv parser: no crate writes compose's env-file format (dotenvy and
/// friends only read), and the values come from Doppler so they can contain
/// spaces, quotes, and newlines. Values that need it are double-quoted with
/// escapes so compose's `env_file` parser round-trips them.
fn write_dotenv(path: &Path, env: &BTreeMap<String, String>) -> Result<()> {
    let mut out =
        String::from("# GENERATED by `cargo x` — do not edit. Regenerate via run-local/run-dev.\n");
    for (k, v) in env {
        out.push_str(&dotenv_line(k, v));
        out.push('\n');
    }
    std::fs::write(path, out).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

fn dotenv_line(key: &str, value: &str) -> String {
    let needs_quote = value.is_empty()
        || value.contains(['\n', '\t', '"', '#', ' ', '\''])
        || value.starts_with(char::is_whitespace);
    if needs_quote {
        let escaped = value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\t', "\\t");
        format!("{key}=\"{escaped}\"")
    } else {
        format!("{key}={value}")
    }
}

/// A short, category-bucketed summary of the resolved env (never prints secret
/// values).
pub fn summarize(env: &BTreeMap<String, String>) -> String {
    let count = |pred: fn(&str) -> bool| env.keys().filter(|k| pred(k)).count();
    format!(
        "{} keys (db:{} aws/buckets:{} queues:{} dynamodb:{} fusionauth:{} secrets:{} urls:{})",
        env.len(),
        count(|k| k.contains("DATABASE") || k.contains("REDIS") || k.contains("OPENSEARCH")),
        count(|k| k.starts_with("AWS_") || k.contains("BUCKET") || k.contains("LOCAL_AWS")),
        count(|k| k.contains("QUEUE")),
        count(|k| k.contains("TABLE") || k.contains("DYNAMODB")),
        count(|k| k.contains("FUSIONAUTH") || k.contains("FUSION_AUTH")),
        count(|k| k.contains("SECRET") || k.contains("_KEY") || k.contains("JWT")),
        count(|k| k.contains("URL") || k.contains("_URI")),
    )
}
