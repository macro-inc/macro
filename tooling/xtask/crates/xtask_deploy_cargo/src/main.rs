//! Prints the Cargo selection of every deploy build, one per line as
//! `<source>\t<cargo tree selection args>`, for feature checks to resolve
//! exactly what ships. Deploy builds are the nix `.#deploy-*` derivations
//! (services and Lambdas) and every tracked Dockerfile outside [`EXEMPT`].
//!
//! A Dockerfile whose Cargo commands use build arguments is resolved once per
//! supported Pulumi, Compose or direct just consumer that builds it.
//!
//! Fails, listing every problem, when a deploy build has no recognised Cargo
//! command, uses an argument, wrapper or RUN form the grammar does not read,
//! leaves a build argument unset, selects no package (Cargo would then resolve
//! the whole workspace) or selects a package that is not a workspace member.

mod callers;
mod command;
mod deploy;
mod infra;

use rootcause::prelude::ResultExt;
use rootcause::{Report, bail, report};
use serde_json::Value;
use std::process::Command;

/// Tracked Dockerfiles that are not deploy builds of workspace packages. Any
/// other Dockerfile must yield a Cargo selection, so one that compiles through
/// a wrapper that never names Cargo (worker-build, wasm-pack) fails unless it
/// is listed here.
const PREBUILT: &str =
    "copies the nix-built binary; its selection is checked through the nix deploy roots";
const NO_RUST: &str = "compiles no Rust";
const EXEMPT: &[(&str, &str)] = &[
    ("docker/Dockerfile.prebuilt", PREBUILT),
    ("docker/Dockerfile.convert_service.prebuilt", PREBUILT),
    (
        "docker/Dockerfile.search_processing_service.prebuilt",
        PREBUILT,
    ),
    (
        "docker/Dockerfile.runtime",
        "runtime base image with no workspace code",
    ),
    (
        "docker/Dockerfile.cross-x86_64-unknown-linux-gnu",
        "cross-rs toolchain image; installs system packages only",
    ),
    (
        "docker/sync-service.Dockerfile",
        "local image; worker-build compiles sync_service for wasm32, which \
         check-loro-native-editor-features.sh checks directly",
    ),
    ("docker/ai-editing-worker.Dockerfile", NO_RUST),
    ("docker/analytics-proxy.Dockerfile", NO_RUST),
    ("docker/lexical-service.Dockerfile", NO_RUST),
    ("docker/websocket-service.Dockerfile", NO_RUST),
    ("docker/headless-chrome/Dockerfile", NO_RUST),
    ("infra/local/opensearch/Dockerfile", NO_RUST),
    ("infra/local/sdk-webhook-relay/Dockerfile", NO_RUST),
    ("services/transcription/Dockerfile", NO_RUST),
    (
        "docker/Dockerfile.dev",
        "local docker-compose image; builds every local service binary in one command",
    ),
    (
        "docker/Dockerfile.cache",
        "dependency cache image; cooks the whole workspace and ships no binary",
    ),
    (
        "crates/agent_harness/container/Dockerfile",
        "standalone sidecar crate with its own lockfile, outside the workspace",
    ),
    (
        "services/coding-agent-worker/container/Dockerfile",
        "standalone sidecar crate with its own lockfile, outside the workspace",
    ),
];

fn run(program: &str, args: &[&str]) -> Result<String, Report> {
    let output = Command::new(program)
        .args(args)
        .current_dir(xtask_paths::workspace_root())
        .output()
        .attach_with(|| format!("run {program} {}", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "{program} {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(String::from_utf8(output.stdout).context("command output is not UTF-8")?)
}

fn show(drvs: &[String]) -> Result<Value, Report> {
    let mut args = vec!["derivation", "show"];
    args.extend(drvs.iter().map(String::as_str));
    Ok(serde_json::from_str(&run("nix", &args)?).context("parse nix derivation show")?)
}

fn nix(bound: &mut Vec<deploy::Bound>, errors: &mut Vec<String>) -> Result<usize, Report> {
    let system = run(
        "nix",
        &[
            "eval",
            "--impure",
            "--raw",
            "--expr",
            "builtins.currentSystem",
        ],
    )?;
    let roots: Value = serde_json::from_str(&run(
        "nix",
        &[
            "eval",
            "--json",
            "--apply",
            "p: builtins.listToAttrs (map (n: { name = n; value = p.${n}.drvPath; }) \
             (builtins.filter (n: builtins.match \"deploy-.*\" n != null) (builtins.attrNames p)))",
            &format!(".#packages.{system}"),
        ],
    )?)
    .context("parse deploy derivations")?;
    let roots: Vec<(String, String)> = roots
        .as_object()
        .ok_or_else(|| report!("deploy derivations are not an object"))?
        .iter()
        .filter_map(|(attribute, path)| Some((attribute.clone(), path.as_str()?.to_owned())))
        .collect();
    let paths: Vec<String> = roots.iter().map(|(_, path)| path.clone()).collect();
    let mut shown = show(&paths)?;
    // Bundles copy other derivations' binaries; show those too.
    let bundled: Vec<String> = shown
        .get("derivations")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|derivations| derivations.values())
        .filter_map(|derivation| {
            derivation
                .pointer("/inputs/drvs")
                .and_then(Value::as_object)
        })
        .flat_map(|drvs| drvs.keys())
        .filter(|name| name.contains("-binaries-") && name.ends_with(".drv"))
        .map(|name| format!("/nix/store/{name}"))
        .collect();
    if !bundled.is_empty() {
        let children = show(&bundled)?;
        if let (Some(all), Some(more)) = (
            shown.get_mut("derivations").and_then(Value::as_object_mut),
            children.get("derivations").and_then(Value::as_object),
        ) {
            all.extend(more.clone());
        }
    }
    let basename = |path: &str| path.rsplit('/').next().unwrap_or(path).to_owned();
    let roots: Vec<(String, String)> = roots
        .into_iter()
        .map(|(attribute, path)| (attribute, basename(&path)))
        .collect();
    let (more, problems) = deploy::nix_selections(&roots, &shown);
    bound.extend(more);
    errors.extend(problems);
    Ok(roots.len())
}

fn dockerfiles(bound: &mut Vec<deploy::Bound>, errors: &mut Vec<String>) -> Result<usize, Report> {
    let tracked = run("git", &["ls-files"])?;
    let files: Vec<&str> = tracked
        .lines()
        .filter(|path| {
            path.rsplit('/')
                .next()
                .is_some_and(|name| name.contains("Dockerfile"))
        })
        .filter(|path| !path.ends_with(".dockerignore"))
        .collect();
    for (exempt, _) in EXEMPT {
        if !files.contains(exempt) {
            errors.push(format!("exempt Dockerfile {exempt} no longer exists"));
        }
    }
    let mut consumers = Vec::new();
    for stack in tracked.lines().filter(|path| {
        path.starts_with("infra/stacks/") && path.ends_with(".ts") && !path.ends_with(".test.ts")
    }) {
        let text = std::fs::read_to_string(xtask_paths::workspace_root().join(stack))
            .attach_with(|| format!("read {stack}"))?;
        match infra::consumers(stack, &text) {
            Ok(found) => consumers.extend(found),
            Err(error) => errors.push(error),
        }
    }
    for path in tracked.lines().filter(|path| {
        path.ends_with(".yml")
            || path.ends_with(".yaml")
            || path.ends_with(".sh")
            || path.rsplit('/').next() == Some("justfile")
    }) {
        let text = std::fs::read_to_string(xtask_paths::workspace_root().join(path))
            .attach_with(|| format!("read {path}"))?;
        match callers::consumers(path, &text) {
            Ok(found) => consumers.extend(found),
            Err(error) => errors.push(error),
        }
    }
    for consumer in &consumers {
        if !files.contains(&consumer.dockerfile.as_str()) {
            errors.push(format!(
                "{} builds {}, which is not a tracked Dockerfile",
                consumer.source, consumer.dockerfile
            ));
        }
    }
    let mut scanned = 0;
    for file in files {
        if EXEMPT.iter().any(|(exempt, _)| *exempt == file) {
            continue;
        }
        let text = std::fs::read_to_string(xtask_paths::workspace_root().join(file))
            .attach_with(|| format!("read {file}"))?;
        let users: Vec<&infra::Consumer> = consumers
            .iter()
            .filter(|consumer| consumer.dockerfile == file)
            .collect();
        let (more, problems) = deploy::dockerfile_selections(file, &text, &users);
        bound.extend(more);
        errors.extend(problems);
        scanned += 1;
    }
    Ok(scanned)
}

fn workspace_members() -> Result<Vec<String>, Report> {
    let metadata: Value = serde_json::from_str(&run(
        "cargo",
        &["metadata", "--locked", "--no-deps", "--format-version", "1"],
    )?)
    .context("parse cargo metadata")?;
    Ok(metadata
        .get("packages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|package| Some(package.get("name")?.as_str()?.to_owned()))
        .collect())
}

fn main() -> Result<(), Report> {
    let mut bound = Vec::new();
    let mut errors = Vec::new();
    let roots = nix(&mut bound, &mut errors)?;
    let files = dockerfiles(&mut bound, &mut errors)?;
    if roots < 10 {
        errors.push(format!("only {roots} nix deploy builds found"));
    }
    let members = workspace_members()?;
    for deploy::Bound { source, selection } in &bound {
        for package in &selection.packages {
            if !members.contains(package) {
                errors.push(format!("{source}: {package} is not a workspace package"));
            }
        }
    }
    if !errors.is_empty() {
        for error in &errors {
            eprintln!("{error}");
        }
        bail!("{} deploy build problems", errors.len());
    }
    for deploy::Bound { source, selection } in &bound {
        let args = selection.tree_args();
        println!("{source}\t{}", args.join(" "));
    }
    eprintln!(
        "{roots} nix deploy builds and {files} Dockerfiles: {} selections",
        bound.len()
    );
    Ok(())
}
