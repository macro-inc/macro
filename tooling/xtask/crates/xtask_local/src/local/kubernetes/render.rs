use super::*;
use serde::Deserialize;
#[cfg(test)]
mod test;

fn flake(state: &Path, params: &Value, field: &str) -> Result<PathBuf> {
    let name = params["name"].as_str().context("instance name missing")?;
    validate_name(name)?;
    let revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(params, field))?)
    );
    let directory = state.join("builds").join(format!("{name}-{revision}"));
    std::fs::create_dir_all(&directory)?;
    // A pure flake keeps source and instance parameters explicit. The JSON
    // contains references and revision hashes, never credential values.
    let root = serde_json::to_string(&format!(
        "git+file://{}",
        super::super::repo_root().display()
    ))?
    .replace("${", "\\${");
    let source = format!(
        "{{ inputs.macro.url = {root}; outputs = {{ macro, ... }}: {{ packages.x86_64-linux.default = (macro.kubeLocal.instance (builtins.fromJSON (builtins.readFile ./params.json))).{field}; }}; }}"
    );
    for (name, contents) in [
        ("params.json", serde_json::to_string_pretty(params)?),
        ("flake.nix", source),
    ] {
        let file = directory.join(name);
        if std::fs::read(&file).ok().as_deref() != Some(contents.as_bytes()) {
            std::fs::write(file, contents)?;
        }
    }
    Ok(directory)
}

fn source_fingerprint(root: &Path) -> Result<String> {
    let mut digest = Sha256::new();
    for args in [
        vec!["rev-parse", "HEAD"],
        vec!["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"],
    ] {
        let result = Command::new("git").current_dir(root).args(args).output()?;
        ensure!(
            result.status.success(),
            "cannot fingerprint tracked sources"
        );
        digest.update(result.stdout.len().to_le_bytes());
        digest.update(result.stdout);
    }
    let version = Command::new("nix").arg("--version").output()?;
    ensure!(version.status.success(), "cannot identify Nix version");
    digest.update(version.stdout);
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn build(state: &Path, params: &Value, field: &str) -> Result<PathBuf> {
    let directory = flake(state, params, field)?;
    let root = super::super::repo_root();
    let fingerprint = source_fingerprint(&root)?;
    // Keep cache metadata outside the flake source: embedding a store path in
    // that source would retain previous outputs and change its own fingerprint.
    let cache = directory.with_extension("json");
    let cached = std::fs::read(&cache)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .filter(|value| value["source"] == fingerprint)
        .and_then(|value| value["output"].as_str().map(PathBuf::from))
        .filter(|path| path.parent() == Some(Path::new("/nix/store")) && path.exists());
    let mut command = Command::new("nix");
    command.current_dir(&root).stderr(Stdio::inherit()).args([
        "build",
        "--no-link",
        "--print-out-paths",
    ]);
    if let Some(output) = &cached {
        // Nix validates/realizes the existing output without evaluating the
        // complete manifest graph again. Collected outputs take the flake path.
        command.arg(output);
    } else {
        command.args([
            "--no-write-lock-file",
            "--override-input",
            "macro",
            &format!("git+file://{}", root.display()),
            &format!("path:{}#default", directory.display()),
        ]);
    }
    let result = command.output()?;
    ensure!(result.status.success(), "Nix instance build failed");
    let output = PathBuf::from(String::from_utf8(result.stdout)?.trim());
    ensure!(
        output.parent() == Some(Path::new("/nix/store")) && output.exists(),
        "Nix did not return an existing store output"
    );
    // Never associate a concurrently changed checkout with this snapshot.
    if cached.is_none() && source_fingerprint(&root)? == fingerprint {
        std::fs::write(
            cache,
            serde_json::to_vec(&json!({
                "source": fingerprint,
                "output": output,
            }))?,
        )?;
    }
    Ok(output)
}

pub(super) fn push(state: &Path, params: &Value, names: Option<&[String]>) -> Result<()> {
    let selection = if let Some(names) = names {
        format!(
            "(builtins.fromJSON {})",
            serde_json::to_string(&serde_json::to_string(names)?)?
        )
    } else {
        "null".into()
    };
    let field = format!("push {selection}");
    let script = build(state, params, &field)?;
    push_store(&script)
}

pub(super) fn push_store(script: &Path) -> Result<()> {
    let status = Command::new(script.join("bin/push-images")).status()?;
    ensure!(status.success(), "image push failed");
    Ok(())
}

pub(super) fn reference(state: &Path, args: &Render) -> Result<()> {
    validate_name(&args.name)?;
    let params = json!({"name": args.name, "enableGmail": true});
    let rendered = build(state, &params, "manifests")?;
    check_directory(&rendered)?;
    let destination = args
        .output
        .clone()
        .unwrap_or_else(|| super::super::repo_root().join("infra/k8s/rendered"));
    if args.check {
        let result = Command::new("diff")
            .args(["-ru"])
            .arg(&destination)
            .arg(&rendered)
            .status()?;
        ensure!(
            result.success(),
            "committed YAML differs; run just kube-local render"
        );
    } else {
        std::fs::create_dir_all(&destination)?;
        for file in std::fs::read_dir(&destination)? {
            let file = file?;
            ensure!(
                file.path().extension().is_some_and(|e| e == "yaml"),
                "unexpected file in render output"
            );
            std::fs::remove_file(file.path())?;
        }
        for file in std::fs::read_dir(&rendered)? {
            let file = file?;
            std::fs::copy(file.path(), destination.join(file.file_name()))?;
        }
    }
    Ok(())
}

pub(super) fn check_directory(path: &Path) -> Result<()> {
    for file in std::fs::read_dir(path)? {
        let file = file?;
        if file.path().extension().is_some_and(|e| e == "yaml") {
            let contents = std::fs::read_to_string(file.path())?;
            for document in serde_yaml::Deserializer::from_str(&contents) {
                check_value(&Value::deserialize(document)?)?;
            }
        }
    }
    Ok(())
}

pub(super) fn check_value(value: &Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            ensure!(
                map.get("kind").and_then(Value::as_str) != Some("Secret"),
                "runtime Secrets must never be rendered by Nix"
            );
            if let (Some(name), Some(_)) =
                (map.get("name").and_then(Value::as_str), map.get("value"))
            {
                let key = name.to_ascii_uppercase();
                ensure!(
                    ![
                        "PASSWORD",
                        "SECRET",
                        "TOKEN",
                        "API_KEY",
                        "ACCESS_KEY",
                        "PRIVATE_KEY",
                        "AUTH_KEY",
                        "AUTHORIZATION",
                        "CREDENTIAL",
                        "SIGNING_KEY"
                    ]
                    .iter()
                    .any(|part| key.contains(part)),
                    "credential-like environment variable has a literal value"
                );
            }
            for value in map.values() {
                check_value(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                check_value(value)?;
            }
        }
        Value::String(text) => {
            ensure!(
                ![
                    "-----BEGIN PRIVATE KEY",
                    "-----BEGIN RSA PRIVATE KEY",
                    "-----BEGIN OPENSSH PRIVATE KEY",
                    "sk-ant-",
                    "sk-proj-",
                    "ghp_",
                    "github_pat_",
                    "dop_v1_",
                    "AKIA"
                ]
                .iter()
                .any(|prefix| text.contains(prefix)),
                "rendered YAML contains credential-shaped data"
            );
            // JWTs have three base64url segments; public local UUIDs do not.
            ensure!(
                !text.starts_with("eyJ") || text.split('.').count() != 3,
                "rendered YAML contains a JWT"
            );
            if let Some((_, rest)) = text.split_once("://") {
                let authority = rest.split(['/', ' ', '\n']).next().unwrap_or("");
                ensure!(
                    !authority
                        .split_once('@')
                        .is_some_and(|(identity, _)| identity.contains(':')),
                    "rendered YAML contains a credential URL"
                );
            }
            ensure!(
                !text.starts_with("Bearer ") && !text.starts_with("Basic "),
                "rendered YAML contains an authorization value"
            );
        }
        _ => {}
    }
    Ok(())
}
