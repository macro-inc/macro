//! The deploy repo and Argo CD: how rendered manifests reach a cluster.
//!
//! `platform up` and `dev` commit nixidy's output to `platform/deploy` in the
//! cluster's forge. The root Application syncs every Application under `apps/`,
//! so an instance exists because its manifests are in git, on every cluster.
//! Secrets stay out of the repo; `platform up` applies them directly.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::{INGRESS_PORT, apply_items, kubectl, repo_root, secret};
use crate::local::stage::Stage;

const FORGE_HOST: &str = "git.localhost";
const ARGOCD_HOST: &str = "argocd.localhost";
const FORGE_NAMESPACE: &str = "forge";
const ARGOCD_NAMESPACE: &str = "argocd";
const FORGE_ADMIN_SECRET: &str = "forge-admin";
const FORGE_ADMIN_USER: &str = "platform-admin";
const RUNNER_TOKEN_SECRET: &str = "forge-runner-token";
const FORGE_ORG: &str = "platform";
/// Where this repo is mirrored for CI.
const SOURCE_REPO: &str = "macro";
const DEPLOY_REPO: &str = "deploy";
/// The deploy repo as Argo CD reaches it, inside the cluster.
const DEPLOY_REPO_IN_CLUSTER: &str =
    "http://gitea-http.forge.svc.cluster.local:3000/platform/deploy.git";
const ROOT_APPLICATION: &str = "apps";
/// Applications `cluster` applies directly the first time, before Argo CD and
/// the repo it syncs from exist. After that, Argo CD manages them too.
const BOOTSTRAP_APPLICATIONS: &[&str] = &["traefik", "argocd", "forge"];
/// Everything the cluster environment deploys (`cluster.nix`).
const CLUSTER_APPLICATIONS: &[&str] = &["traefik", "argocd", "forge", "forge-runners"];

/// Generated files for the cluster itself, not any one instance.
fn cluster_dir() -> PathBuf {
    repo_root().join("infra/local/generated/platform-cluster")
}

fn forge_url(path: &str) -> String {
    format!("https://{FORGE_HOST}:{INGRESS_PORT}/{path}")
}

fn ca_file() -> PathBuf {
    repo_root().join("infra/local/certs/ca.pem")
}

/// Ensure the cluster's shared services run and are managed from the deploy
/// repo. Idempotent; `rendered` is the cluster environment from nixidy.
pub fn ensure_cluster(stage: &Stage, rendered: &Path) -> Result<()> {
    let bootstrapped = kubectl()
        .args([
            "-n",
            ARGOCD_NAMESPACE,
            "get",
            "application",
            ROOT_APPLICATION,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?
        .success();
    if !bootstrapped {
        for app in BOOTSTRAP_APPLICATIONS {
            apply_namespace_of(stage, app)?;
        }
        ensure_secrets(stage)?;
        for app in BOOTSTRAP_APPLICATIONS {
            apply_rendered(stage, &rendered.join(app))?;
        }
        wait_deployments(stage, FORGE_NAMESPACE)?;
        wait_deployments(stage, ARGOCD_NAMESPACE)?;
    }
    ensure_deploy_repo(stage)?;
    let revision = publish(stage, "cluster", rendered)?;
    if !bootstrapped {
        apply_items(stage, "root application", &[root_application()])?;
    }
    wait_synced(stage, ROOT_APPLICATION, &revision)?;
    for app in CLUSTER_APPLICATIONS {
        wait_synced(stage, app, &revision)?;
    }
    Ok(())
}

fn apply_namespace_of(stage: &Stage, app: &str) -> Result<()> {
    let namespace = match app {
        "traefik" => "platform-ingress",
        "argocd" => ARGOCD_NAMESPACE,
        "forge" => FORGE_NAMESPACE,
        other => bail!("no namespace known for {other}"),
    };
    apply_items(
        stage,
        &format!("namespace {namespace}"),
        &[json!({
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": { "name": namespace },
        })],
    )
}

/// Server-side, because Argo CD's CRDs exceed the client-side annotation limit.
fn apply_rendered(stage: &Stage, dir: &Path) -> Result<()> {
    let mut cmd = kubectl();
    cmd.args([
        "apply",
        "--server-side",
        "--force-conflicts",
        "--field-manager=macro-platform",
        "-f",
    ])
    // The trailing slash resolves the symlink nixidy's output dir is.
    .arg(format!("{}/", dir.display()))
    .stdout(Stdio::null());
    stage.run(&format!("Applying {}", dir.display()), &mut cmd)
}

fn wait_deployments(stage: &Stage, namespace: &str) -> Result<()> {
    let mut cmd = kubectl();
    cmd.args([
        "-n",
        namespace,
        "wait",
        "deployment",
        "--all",
        "--for=condition=Available",
        "--timeout=15m",
    ]);
    stage.run(&format!("Waiting for {namespace}"), &mut cmd)
}

/// The forge login and per-host certificates, generated once.
fn ensure_secrets(stage: &Stage) -> Result<()> {
    if read_secret(FORGE_NAMESPACE, FORGE_ADMIN_SECRET, "password").is_err() {
        apply_items(
            stage,
            "forge admin",
            &[secret(
                FORGE_NAMESPACE,
                FORGE_ADMIN_SECRET,
                "Opaque",
                &[
                    ("username".to_owned(), FORGE_ADMIN_USER.to_owned()),
                    ("password".to_owned(), super::random_hex()?),
                    (
                        "email".to_owned(),
                        format!("{FORGE_ADMIN_USER}@{FORGE_HOST}"),
                    ),
                ]
                .into(),
            )],
        )?;
    }
    for (namespace, name, host) in [
        (FORGE_NAMESPACE, "forge-tls", FORGE_HOST),
        (ARGOCD_NAMESPACE, "argocd-tls", ARGOCD_HOST),
    ] {
        let certs = super::issue_certificate(&cluster_dir().join(name), host)?;
        apply_items(
            stage,
            name,
            &[secret(
                namespace,
                name,
                "kubernetes.io/tls",
                &[
                    (
                        "tls.crt".to_owned(),
                        std::fs::read_to_string(certs.join("server.pem"))?,
                    ),
                    (
                        "tls.key".to_owned(),
                        std::fs::read_to_string(certs.join("server-key.pem"))?,
                    ),
                ]
                .into(),
            )],
        )?;
    }
    Ok(())
}

fn read_secret(namespace: &str, name: &str, key: &str) -> Result<String> {
    let out = kubectl()
        .args([
            "-n",
            namespace,
            "get",
            "secret",
            name,
            "-o",
            &format!("jsonpath={{.data.{key}}}"),
        ])
        .output()?;
    ensure!(
        out.status.success() && !out.stdout.is_empty(),
        "secret {namespace}/{name} has no {key}"
    );
    use base64::Engine as _;
    let decoded = base64::engine::general_purpose::STANDARD.decode(out.stdout)?;
    Ok(String::from_utf8(decoded)?)
}

fn forge_password() -> Result<String> {
    read_secret(FORGE_NAMESPACE, FORGE_ADMIN_SECRET, "password")
}

/// A forge API call as the admin. `curl` reads the login from stdin so it
/// never appears in a process listing.
fn forge_api(method: &str, path: &str, body: &Value) -> Result<u16> {
    let password = forge_password()?;
    let mut child = Command::new("curl")
        .args([
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--config",
            "-",
            "-X",
            method,
            "-H",
            "Content-Type: application/json",
            "--data",
        ])
        .arg(body.to_string())
        .arg("--cacert")
        .arg(ca_file())
        .arg(forge_url(&format!("api/v1/{path}")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .context("running curl")?;
    {
        use std::io::Write;
        writeln!(
            child.stdin.take().context("curl stdin")?,
            "user = \"{FORGE_ADMIN_USER}:{password}\""
        )?;
    }
    let out = child.wait_with_output()?;
    ensure!(out.status.success(), "forge API {method} {path} failed");
    Ok(String::from_utf8(out.stdout)?.trim().parse()?)
}

/// Create an organization and repo if they are missing.
pub fn ensure_forge_repo(stage: &Stage, org: &str, repo: &str, private: bool) -> Result<()> {
    stage.run_step(&format!("Ensuring {org}/{repo} in the forge"), || {
        let org_status = forge_api(
            "POST",
            "orgs",
            &json!({ "username": org, "visibility": "private" }),
        )?;
        ensure!(
            matches!(org_status, 201 | 409 | 422),
            "creating organization {org}: HTTP {org_status}"
        );
        let repo_status = forge_api(
            "POST",
            &format!("orgs/{org}/repos"),
            &json!({ "name": repo, "private": private, "default_branch": "main" }),
        )?;
        ensure!(
            matches!(repo_status, 201 | 409),
            "creating repo {org}/{repo}: HTTP {repo_status}"
        );
        Ok(())
    })
}

/// Argo CD's read credential for the deploy repo.
fn ensure_deploy_repo(stage: &Stage) -> Result<()> {
    wait_for_forge(stage)?;
    ensure_forge_repo(stage, FORGE_ORG, DEPLOY_REPO, true)?;
    ensure_runner_secrets(stage)?;
    apply_items(
        stage,
        "deploy repo credential",
        &[{
            let mut credential = secret(
                ARGOCD_NAMESPACE,
                "deploy-repo",
                "Opaque",
                &[
                    ("type".to_owned(), "git".to_owned()),
                    ("url".to_owned(), DEPLOY_REPO_IN_CLUSTER.to_owned()),
                    ("username".to_owned(), FORGE_ADMIN_USER.to_owned()),
                    ("password".to_owned(), forge_password()?),
                ]
                .into(),
            );
            credential["metadata"]["labels"]["argocd.argoproj.io/secret-type"] =
                json!("repository");
            credential
        }],
    )
}

/// What the forge's runners need before Argo CD starts them: a registration token.
fn ensure_runner_secrets(stage: &Stage) -> Result<()> {
    if read_secret(FORGE_NAMESPACE, RUNNER_TOKEN_SECRET, "token").is_err() {
        let out = kubectl()
            .args([
                "-n",
                FORGE_NAMESPACE,
                "exec",
                "deploy/gitea",
                "-c",
                "gitea",
                "--",
                "gitea",
                "actions",
                "generate-runner-token",
            ])
            .output()?;
        ensure!(
            out.status.success(),
            "generating a runner token: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        apply_items(
            stage,
            "runner token",
            &[secret(
                FORGE_NAMESPACE,
                RUNNER_TOKEN_SECRET,
                "Opaque",
                &[(
                    "token".to_owned(),
                    String::from_utf8(out.stdout)?.trim().to_owned(),
                )]
                .into(),
            )],
        )?;
    }
    Ok(())
}

fn wait_for_forge(stage: &Stage) -> Result<()> {
    stage.run_step("Waiting for the forge's ingress", || {
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            let status = Command::new("curl")
                .args(["-fsS", "-o", "/dev/null", "--cacert"])
                .arg(ca_file())
                .arg(forge_url("api/healthz"))
                .stderr(Stdio::null())
                .status()?;
            if status.success() {
                return Ok(());
            }
            ensure!(
                Instant::now() < deadline,
                "the forge never became reachable"
            );
            std::thread::sleep(Duration::from_secs(2));
        }
    })
}

/// Git authenticated as the forge admin. The login goes through the
/// environment, not argv, and never into the clone's config.
pub fn forge_git(cwd: &Path) -> Result<Command> {
    use base64::Engine as _;
    let token = base64::engine::general_purpose::STANDARD
        .encode(format!("{FORGE_ADMIN_USER}:{}", forge_password()?));
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "http.extraHeader")
        .env(
            "GIT_CONFIG_VALUE_0",
            format!("Authorization: Basic {token}"),
        )
        .env("GIT_CONFIG_KEY_1", "http.sslCAInfo")
        .env("GIT_CONFIG_VALUE_1", ca_file())
        .env("GIT_AUTHOR_NAME", "macro-platform")
        .env("GIT_AUTHOR_EMAIL", "platform@git.localhost")
        .env("GIT_COMMITTER_NAME", "macro-platform")
        .env("GIT_COMMITTER_EMAIL", "platform@git.localhost");
    Ok(cmd)
}

fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let out = forge_git(cwd)?.args(args).output().context("running git")?;
    ensure!(
        out.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?.trim().to_owned())
}

/// A checkout of the deploy repo at the forge's current main.
fn deploy_checkout() -> Result<PathBuf> {
    let dir = cluster_dir().join("deploy");
    let url = forge_url(&format!("{FORGE_ORG}/{DEPLOY_REPO}.git"));
    if !dir.join(".git").is_dir() {
        std::fs::create_dir_all(&dir)?;
        git(&dir, &["init", "-q", "-b", "main"])?;
        git(&dir, &["remote", "add", "origin", &url])?;
    }
    let has_main = !git(&dir, &["ls-remote", "origin", "main"])?.is_empty();
    if has_main {
        git(&dir, &["fetch", "-q", "origin", "main"])?;
        git(&dir, &["reset", "-q", "--hard", "FETCH_HEAD"])?;
    }
    Ok(dir)
}

/// The file an environment's Application is published as under `apps/`.
pub(super) fn app_link(env: &str, application_file: &str) -> String {
    // Two dashes, which an instance name cannot hold: `demo`'s prefix must not match `demo-2`.
    format!("{}--{application_file}", env.replace('/', "-"))
}

/// Commit an environment's rendered manifests and return the revision.
/// `env` is the root path nixidy rendered for (`cluster`, `instances/demo`).
pub fn publish(stage: &Stage, env: &str, rendered: &Path) -> Result<String> {
    let mut revision = String::new();
    stage.run_step(&format!("Publishing {env} to the deploy repo"), || {
        let repo = deploy_checkout()?;
        let target = repo.join(env);
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        std::fs::create_dir_all(&target)?;
        let copied = Command::new("cp")
            .args(["-rLT", "--no-preserve=mode"])
            .arg(rendered)
            .arg(&target)
            .status()?;
        ensure!(copied.success(), "copying rendered manifests failed");
        let apps = repo.join("apps");
        std::fs::create_dir_all(&apps)?;
        let prefix = app_link(env, "");
        for entry in std::fs::read_dir(&apps)? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                std::fs::remove_file(entry.path())?;
            }
        }
        for entry in std::fs::read_dir(target.join("apps"))? {
            let entry = entry?;
            let file = entry.file_name().to_string_lossy().into_owned();
            std::fs::copy(entry.path(), apps.join(app_link(env, &file)))?;
        }
        git(&repo, &["add", "-A"])?;
        if !git(&repo, &["status", "--porcelain"])?.is_empty() {
            git(&repo, &["commit", "-q", "-m", &format!("publish {env}")])?;
            git(&repo, &["push", "-q", "origin", "main"])?;
        }
        revision = git(&repo, &["rev-parse", "HEAD"])?;
        Ok(())
    })?;
    Ok(revision)
}

/// Remove an environment from the deploy repo. Argo CD then deletes its
/// Applications, and their finalizers delete what they manage.
pub fn retract(stage: &Stage, env: &str) -> Result<String> {
    let mut revision = String::new();
    stage.run_step(&format!("Removing {env} from the deploy repo"), || {
        let repo = deploy_checkout()?;
        let target = repo.join(env);
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        let prefix = app_link(env, "");
        for entry in std::fs::read_dir(repo.join("apps"))? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                std::fs::remove_file(entry.path())?;
            }
        }
        git(&repo, &["add", "-A"])?;
        if !git(&repo, &["status", "--porcelain"])?.is_empty() {
            git(&repo, &["commit", "-q", "-m", &format!("remove {env}")])?;
            git(&repo, &["push", "-q", "origin", "main"])?;
        }
        revision = git(&repo, &["rev-parse", "HEAD"])?;
        Ok(())
    })?;
    Ok(revision)
}

/// Mirror the local view of main and the current branch to the forge and open a pull request for
/// the branch, which is what runs CI there. GitHub remains the source of truth.
pub fn mirror(stage: &Stage) -> Result<()> {
    let root = repo_root();
    let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    ensure!(branch != "HEAD", "check out a branch to mirror");
    ensure_forge_repo(stage, FORGE_ORG, SOURCE_REPO, true)?;
    let url = forge_url(&format!("{FORGE_ORG}/{SOURCE_REPO}.git"));
    stage.run_step("Pushing to the forge", || {
        git(
            &root,
            &[
                "push",
                "-q",
                "--force",
                "--no-verify",
                &url,
                "refs/remotes/origin/main:refs/heads/main",
                &format!("HEAD:refs/heads/{branch}"),
            ],
        )?;
        Ok(())
    })?;
    if branch != "main" {
        open_pull_request(&branch)?;
    }
    stage.note(&format!(
        "ci: {}",
        forge_url(&format!("{FORGE_ORG}/{SOURCE_REPO}/actions"))
    ));
    Ok(())
}

fn open_pull_request(branch: &str) -> Result<()> {
    let body = json!({ "base": "main", "head": branch, "title": branch });
    let path = format!("repos/{FORGE_ORG}/{SOURCE_REPO}/pulls");
    let mut attempts = 0;
    loop {
        let status = forge_api("POST", &path, &body)?;
        // 409: this branch already has an open pull request.
        if matches!(status, 201 | 409) {
            return Ok(());
        }
        // 404 until the forge has indexed the branches just pushed.
        attempts += 1;
        ensure!(
            status == 404 && attempts < 30,
            "opening a pull request: HTTP {status}"
        );
        std::thread::sleep(Duration::from_secs(2));
    }
}

/// Syncs `apps/`, so adding or removing a file there adds or removes an
/// Application. It carries no finalizer: deleting it must not cascade.
fn root_application() -> Value {
    json!({
        "apiVersion": "argoproj.io/v1alpha1",
        "kind": "Application",
        "metadata": { "name": ROOT_APPLICATION, "namespace": ARGOCD_NAMESPACE },
        "spec": {
            "project": "default",
            "source": {
                "repoURL": DEPLOY_REPO_IN_CLUSTER,
                "targetRevision": "main",
                "path": "apps",
            },
            "destination": {
                "server": "https://kubernetes.default.svc",
                "namespace": ARGOCD_NAMESPACE,
            },
            "syncPolicy": { "automated": { "prune": true, "selfHeal": true } },
        },
    })
}

/// Ask Argo CD to look at git now instead of at its next poll.
pub fn refresh(application: &str) -> Result<()> {
    let status = kubectl()
        .args([
            "-n",
            ARGOCD_NAMESPACE,
            "annotate",
            "application",
            application,
            "argocd.argoproj.io/refresh=normal",
            "--overwrite",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    ensure!(status.success(), "refreshing {application} failed");
    Ok(())
}

fn application(name: &str) -> Result<Option<Value>> {
    let out = kubectl()
        .args([
            "-n",
            ARGOCD_NAMESPACE,
            "get",
            "application",
            name,
            "--ignore-not-found",
            "-o",
            "json",
        ])
        .output()?;
    ensure!(out.status.success(), "reading application {name} failed");
    if out.stdout.is_empty() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&out.stdout)?))
}

/// Whether an Application has synced `revision` and everything in it is healthy.
pub fn is_converged(app: &Value, revision: &str) -> bool {
    app["status"]["sync"]["revision"] == revision
        && app["status"]["sync"]["status"] == "Synced"
        && app["status"]["health"]["status"] == "Healthy"
}

/// What an Application is still waiting on, for progress and failure output.
pub fn unhealthy_resources(app: &Value) -> Vec<String> {
    app["status"]["resources"]
        .as_array()
        .map(|resources| {
            resources
                .iter()
                .filter(|r| {
                    r["health"]["status"]
                        .as_str()
                        .is_some_and(|h| h != "Healthy")
                        || r["status"] == "OutOfSync"
                })
                .map(|r| {
                    format!(
                        "{}/{}: {} {}",
                        r["kind"].as_str().unwrap_or("?"),
                        r["name"].as_str().unwrap_or("?"),
                        r["status"].as_str().unwrap_or("?"),
                        r["health"]["status"].as_str().unwrap_or("-"),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Wait for Argo CD to sync `revision` and report everything healthy. Sync
/// waves give the order: data plane, provisioning, services.
pub fn wait_synced(stage: &Stage, name: &str, revision: &str) -> Result<()> {
    let timeout = Duration::from_secs(30 * 60);
    let deadline = Instant::now() + timeout;
    let mut last: Vec<String> = Vec::new();
    let result = stage.run_step(&format!("Waiting for Argo CD to sync {name}"), || {
        loop {
            if let Some(app) = application(name)? {
                // Publishing another environment moves the repo's head, so an
                // Application can legitimately sync past `revision`.
                let at = app["status"]["sync"]["revision"]
                    .as_str()
                    .unwrap_or_default();
                let target = if contains(at, revision) { at } else { revision };
                if is_converged(&app, target) {
                    return Ok(());
                }
                let phase = app["status"]["operationState"]["phase"].as_str();
                let operating = app["status"]["operationState"]["operation"]["sync"]["revision"]
                    .as_str()
                    .unwrap_or_default();
                let synced_this = contains(operating, revision);
                // Argo CD finishes a running sync before starting another, and
                // one stuck on an unhealthy wave never finishes.
                if !synced_this && matches!(phase, Some("Running")) {
                    terminate_operation(name)?;
                }
                if synced_this && matches!(phase, Some("Error")) {
                    bail!(
                        "sync failed: {}",
                        app["status"]["operationState"]["message"]
                            .as_str()
                            .unwrap_or("no message")
                    );
                }
                let waiting = unhealthy_resources(&app);
                if waiting != last {
                    eprintln!(
                        "  {name}: {} waiting{}",
                        waiting.len(),
                        waiting
                            .first()
                            .map(|r| format!(", first {r}"))
                            .unwrap_or_default()
                    );
                }
                last = waiting;
            }
            refresh(name).ok();
            ensure!(
                Instant::now() < deadline,
                "{name} did not converge on {revision} in {} minutes",
                timeout.as_secs() / 60
            );
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    if result.is_err() {
        for line in &last {
            eprintln!("  {line}");
        }
    }
    result
}

/// Whether deploy-repo commit `descendant` includes `revision`.
fn contains(descendant: &str, revision: &str) -> bool {
    if descendant == revision {
        return true;
    }
    if descendant.is_empty() {
        return false;
    }
    let repo = cluster_dir().join("deploy");
    git(&repo, &["fetch", "-q", "origin", "main"]).is_ok()
        && Command::new("git")
            .current_dir(&repo)
            .args(["merge-base", "--is-ancestor", revision, descendant])
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

/// Stop a sync of an older revision, so the published one can start.
fn terminate_operation(name: &str) -> Result<()> {
    let status = kubectl()
        .args([
            "-n",
            ARGOCD_NAMESPACE,
            "patch",
            "application",
            name,
            "--type=merge",
            "-p",
            r#"{"status":{"operationState":{"phase":"Terminating"}}}"#,
        ])
        .stdout(Stdio::null())
        .status()?;
    ensure!(status.success(), "terminating the sync of {name} failed");
    Ok(())
}

/// Wait for Argo CD to delete an Application and everything it manages.
pub fn wait_deleted(stage: &Stage, name: &str) -> Result<()> {
    stage.run_step(&format!("Waiting for Argo CD to delete {name}"), || {
        let deadline = Instant::now() + Duration::from_secs(600);
        while application(name)?.is_some() {
            refresh(ROOT_APPLICATION).ok();
            ensure!(Instant::now() < deadline, "{name} was not deleted");
            std::thread::sleep(Duration::from_secs(2));
        }
        Ok(())
    })
}
