//! FusionAuth local bootstrap: generate the per-instance kickstart artifacts,
//! wait for readiness, and point the application's redirect URLs at this
//! instance's ports (a restored init snapshot may carry another instance's).

use std::process::Command;

use anyhow::{Context, Result};

use super::instance::{Instance, Port};
use super::{frontend, gen_compose, google_emulator, identity, kickstart, proxy, stage::Stage};

/// The FusionAuth lambda sources, read from the tracked templates at
/// generation time (anchored on [`xtask_paths::repo_root`], so any cwd works).
/// `populate_jwt_local.js` is the unlicensed local variant (see its header);
/// the reconcile lambda is the same file production deploys via Pulumi.
const POPULATE_JWT_LAMBDA: xtask_paths::RepoFile<'static> =
    xtask_paths::RepoFile::new("infra/stacks/fusionauth-instance/templates/populate_jwt_local.js");
const RECONCILE_LAMBDA: xtask_paths::RepoFile<'static> = xtask_paths::RepoFile::new(
    "infra/stacks/fusionauth-instance/templates/reconcile_secondary_idp_link.js",
);

fn read_lambda(file: xtask_paths::RepoFile<'static>) -> Result<String> {
    let path = xtask_paths::repo_root().join(file.as_str());
    std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
}

/// Generate `kickstart.json` into the instance's kickstart dir, which the
/// FusionAuth container mounts. The kickstart is pure identity-provider config:
/// run_local pre-seeds no users — passwordless login auto-creates any user on
/// demand. `google` (a real client from the resolved run env, or the stack's
/// Gmail emulator) configures the `google`/`google_gmail` OIDC IdPs so
/// Google sign-in and the email connect flows work locally,
/// and `github` the `github` IdP that `POST /link/github` resolves; the
/// generated file is gitignored, and the init-snapshot key hashes it, so
/// adding/removing either client re-inits the stack automatically.
pub fn write_kickstart(
    instance: &Instance,
    google: Option<&kickstart::GoogleIdp>,
    github: Option<&kickstart::GithubIdp>,
) -> Result<()> {
    let dir = gen_compose::kickstart_dir(instance);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating kickstart dir {}", dir.display()))?;

    let doc = kickstart::build(
        redirect_urls(instance)?,
        &read_lambda(POPULATE_JWT_LAMBDA)?,
        &read_lambda(RECONCILE_LAMBDA)?,
        google,
        github,
    );
    let json = serde_json::to_string_pretty(&doc)? + "\n";
    std::fs::write(dir.join("kickstart.json"), json)
        .with_context(|| format!("writing {}", dir.join("kickstart.json").display()))?;
    Ok(())
}

/// Block until the kickstart has fully applied (first boot against an empty DB
/// is slow). Runs as a stage so it shows the spinner.
///
/// Polls the kickstart's OWN last artifact — a fetch of the entity its final
/// request creates, authorized by the kickstart API key — NOT `/api/status`:
/// FusionAuth reports status Ok, and serves its API, while the kickstart is
/// still applying, and the snapshot save stops the containers right after
/// this wait. Gating on status alone once froze a mid-kickstart DB into a
/// snapshot (no tenant), and every stack restored from it 500'd at login with
/// `InvalidTenantIdException` — while the key never changed, so the bad
/// snapshot was sticky. Gating on the application, which the kickstart
/// creates midway, let a start go on before the identity providers after it
/// existed. The final request is always an identity provider, created at its
/// own URL.
pub fn wait_ready(stage: &Stage, instance: &Instance) -> Result<()> {
    let base = format!("http://localhost:{}", instance.port(Port::FusionAuth));
    let url = format!("{base}{}", last_kickstart_request(instance)?);
    let application = format!("{base}/api/application/{}", identity::APPLICATION_ID);
    // Require an actual 200: `curl -f` only fails on 400+, so FusionAuth's
    // maintenance-mode 302 (e.g. after a boot-time DB connect failure) would
    // otherwise pass as ready and every later login would 500.
    // FusionAuth only runs a kickstart against an empty database. A resumed
    // stack whose database an older kickstart filled never gets the entity
    // this one creates last: its application answers but that entity stays
    // missing. A running kickstart gets from the application to its last
    // entity in seconds, so say what happened instead of waiting out the
    // whole timeout.
    let script = format!(
        "code() {{ curl -sS -o /dev/null -w '%{{http_code}}' --max-time 3 -H 'Authorization: {key}' \"$1\" 2>/dev/null; }}; \
         settled=0; for i in $(seq 1 480); do \
         [ \"$(code {url})\" = 200 ] && exit 0; \
         if [ \"$(code {application})\" = 200 ]; then settled=$((settled + 1)); fi; \
         if [ \"$settled\" -ge 240 ]; then echo 'FusionAuth was initialised by an older kickstart, which did not create {url}. FusionAuth does not rerun a kickstart on a database it has filled: start the stack with --fresh'; exit 1; fi; \
         sleep 0.5; done; \
         echo 'timed out waiting for the FusionAuth kickstart (a 302 here means maintenance mode: FusionAuth could not reach its db)'; exit 1",
        key = identity::FUSIONAUTH_API_KEY,
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(script);
    stage.run("Waiting for FusionAuth (kickstart)", &mut cmd)
}

/// The API path of the entity the kickstart creates last.
fn last_kickstart_request(instance: &Instance) -> Result<String> {
    let path = gen_compose::kickstart_dir(instance).join("kickstart.json");
    let raw = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
    let doc: serde_json::Value =
        serde_json::from_slice(&raw).with_context(|| format!("parsing {}", path.display()))?;
    let url = doc
        .pointer("/requests")
        .and_then(serde_json::Value::as_array)
        .and_then(|requests| requests.last())
        .and_then(|request| request.get("url"))
        .and_then(serde_json::Value::as_str)
        .with_context(|| format!("{} has no requests", path.display()))?;
    anyhow::ensure!(
        url.starts_with("/api/identity-provider/"),
        "the kickstart's last request must create an identity provider, whose URL can be polled; it is {url}"
    );
    Ok(url.to_string())
}

fn redirect_urls(instance: &Instance) -> Result<Vec<String>> {
    Ok(kickstart::redirect_urls(
        instance.port(Port::Frontend),
        instance.port(Port::Auth),
        &[proxy::url(instance), frontend::https_origin(instance)?],
    ))
}

/// Write this instance's OAuth redirect URLs into the FusionAuth application.
/// The init snapshot key leaves them out, so volumes restored from a snapshot
/// that another port window saved still hold that window's URLs. Reads the
/// application and writes it back whole, so nothing else in it changes. Called
/// after [`wait_ready`].
pub fn apply_redirect_urls(stage: &Stage, instance: &Instance) -> Result<()> {
    let urls = redirect_urls(instance)?;
    let url = format!(
        "http://localhost:{}/api/application/{}",
        instance.port(Port::FusionAuth),
        identity::APPLICATION_ID,
    );
    stage.run_step("Pointing FusionAuth redirects at this instance", || {
        let mut application = curl_json(&url, "GET", None)?;
        let current = application
            .pointer_mut("/application/oauthConfiguration/authorizedRedirectURLs")
            .context("FusionAuth application has no oauthConfiguration.authorizedRedirectURLs")?;
        let wanted = serde_json::Value::from(urls.clone());
        if *current == wanted {
            return Ok(());
        }
        *current = wanted;
        curl_json(&url, "PUT", Some(&application))?;
        Ok(())
    })
}

/// Point the `google` and `google_gmail` identity providers' authorization
/// endpoint at this instance's Gmail emulator. It is the one identity-provider
/// URL a browser opens, so it carries the emulator's published port, which
/// the init snapshot key leaves out like the redirect URLs above. Called
/// after [`wait_ready`], on a stack where the emulator stands in for Google.
pub fn apply_google_authorization_endpoint(stage: &Stage, instance: &Instance) -> Result<()> {
    let wanted = serde_json::Value::from(kickstart::authorization_endpoint(
        &google_emulator::authorization_endpoint(instance),
    ));
    stage.run_step(
        "Pointing FusionAuth's Google sign-in at the Gmail emulator",
        || {
            for id in [identity::GOOGLE_IDP_ID, identity::GOOGLE_GMAIL_IDP_ID] {
                let url = format!(
                    "http://localhost:{}/api/identity-provider/{id}",
                    instance.port(Port::FusionAuth),
                );
                let mut provider = curl_json(&url, "GET", None)?;
                let current = provider
                    .pointer_mut("/identityProvider/oauth2/authorization_endpoint")
                    .context("FusionAuth identity provider has no oauth2.authorization_endpoint")?;
                if *current == wanted {
                    continue;
                }
                *current = wanted.clone();
                curl_json(&url, "PUT", Some(&provider))?;
            }
            Ok(())
        },
    )
}

/// One FusionAuth API call with the kickstart API key, failing on any non-2xx.
fn curl_json(
    url: &str,
    method: &str,
    body: Option<&serde_json::Value>,
) -> Result<serde_json::Value> {
    let mut cmd = Command::new("curl");
    cmd.args([
        "--fail-with-body",
        "--silent",
        "--show-error",
        "--max-time",
        "10",
    ])
    .args(["-X", method])
    .args([
        "-H",
        &format!("Authorization: {}", identity::FUSIONAUTH_API_KEY),
    ])
    .arg(url)
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    if body.is_some() {
        cmd.args([
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ]);
    }
    let mut child = cmd.spawn().context("running curl")?;
    if let Some(body) = body {
        let mut stdin = child.stdin.take().context("curl stdin")?;
        // A curl that failed early has closed its stdin: report its own error
        // below rather than the broken pipe.
        let written = std::io::Write::write_all(&mut stdin, &serde_json::to_vec(body)?);
        if let Err(error) = written
            && error.kind() != std::io::ErrorKind::BrokenPipe
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error).context("writing the request to curl");
        }
    }
    drop(child.stdin.take());
    let output = child.wait_with_output().context("waiting for curl")?;
    anyhow::ensure!(
        output.status.success(),
        "FusionAuth {method} {url} failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout)
        .with_context(|| format!("parsing FusionAuth {method} {url} response"))
}
