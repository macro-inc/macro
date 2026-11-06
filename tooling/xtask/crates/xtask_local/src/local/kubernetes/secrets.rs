use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::collections::BTreeMap;

pub(super) fn create(state: &Path, args: &InstanceArgs, params: &mut Value) -> Result<()> {
    let namespace = namespace(&args.name)?;
    let existing = kubectl(state)
        .args([
            "get",
            "namespace",
            &namespace,
            "--ignore-not-found",
            "-o",
            "name",
        ])
        .output()?;
    ensure!(
        existing.status.success(),
        "cannot inspect namespace ownership"
    );
    if !existing.stdout.is_empty() {
        owned(state, &args.name)?;
    }
    let ns = json!({"apiVersion":"v1", "kind":"Namespace", "metadata": {"name": namespace,
        "annotations": {"macro.local/checkout": super::super::repo_root().to_string_lossy()}}});
    kube(
        state,
        &[
            "apply",
            "--server-side",
            "--field-manager=macro-kube-secrets",
            "-f",
            "-",
        ],
        Some(&ns),
    )?;

    // Existing env layering and certificate helpers accept an instance path.
    // Symlink it to private state before calling them: no generated credential
    // bytes ever land in the checkout (including ignored regular files).
    let instance = super::super::instance::Instance::derive(
        Some(&args.name),
        Some(32434 + u16::from(args.slot)),
    )?;
    let private = state.join(&*args.name);
    std::fs::create_dir_all(&private)?;
    let artifact = instance.artifact_dir();
    if artifact.exists() {
        ensure!(
            artifact.is_symlink(),
            "instance artifacts must live outside the checkout"
        );
        let resolved = std::fs::canonicalize(&artifact)?;
        ensure!(
            !resolved.starts_with(super::super::repo_root()),
            "instance artifacts resolve inside the checkout"
        );
        let marker = resolved.join("kubernetes-owner.json");
        if resolved != private {
            ensure!(
                serde_json::from_slice::<Value>(&std::fs::read(marker)?)?
                    == super::super::repo_root().to_string_lossy().as_ref(),
                "artifact directory belongs to another checkout"
            );
        }
    } else {
        std::fs::create_dir_all(artifact.parent().context("artifact parent missing")?)?;
        std::os::unix::fs::symlink(&private, &artifact)?;
    }
    let resolved = super::super::env_layer::resolve(
        super::super::Mode::Local,
        &instance,
        args.no_doppler,
        args.env_file.as_deref(),
        true,
        super::super::local_env::Tunnels::default(),
        false,
    )?;
    let mut env = resolved.merged;
    normalize(&mut env);
    // The shared local environment also supports host processes. Containers
    // need this override for document initialization, as the Compose path does.
    env.entry("OVERRIDE_SYNC_SERVICE_URL".into())
        .or_insert_with(|| "http://sync-service:8787".into());
    params["enableGmail"] = json!(
        env.get("GMAIL_FORWARDER_SA_KEY")
            .is_some_and(|key| !key.is_empty())
    );
    env.insert("KUBE_POSTGRES_PASSWORD".into(), "password".into());
    env.insert(
        "PLATFORM_FUSIONAUTH_DB_ROOT_PASSWORD".into(),
        "postgres".into(),
    );
    env.insert(
        "PLATFORM_FUSIONAUTH_DB_PASSWORD".into(),
        "fusionauth".into(),
    );
    env.insert("MP_SMTP_AUTH_ACCEPT_ANY".into(), "1".into());
    ensure!(
        env.get("DATABASE_URL")
            .is_some_and(|value| value.contains("@postgres:5432/")),
        "Kubernetes requires the local database endpoint"
    );
    ensure!(
        env.get("LOCAL_AWS_URL")
            .is_some_and(|value| value == "http://localstack:4566"),
        "Kubernetes requires the local AWS endpoint"
    );
    params["envRevision"] = json!(format!("{:x}", Sha256::digest(serde_json::to_vec(&env)?)));
    secret(state, &namespace, "macro-env", &env)?;

    super::super::tls::issue(&instance)?;
    let certs = super::super::tls::certs_dir(&instance);
    secret(
        state,
        &namespace,
        "macro-tls",
        &BTreeMap::from([
            (
                "tls.crt".into(),
                std::fs::read_to_string(certs.join("server.pem"))?,
            ),
            (
                "tls.key".into(),
                std::fs::read_to_string(certs.join("server-key.pem"))?,
            ),
        ]),
    )?;
    super::super::fusionauth::write_kickstart(
        &instance,
        super::super::kickstart::GoogleIdp::from_env(&env).as_ref(),
        super::super::kickstart::GithubIdp::from_env(&env).as_ref(),
    )?;
    secret(
        state,
        &namespace,
        "fusionauth-kickstart",
        &BTreeMap::from([(
            "kickstart.json".into(),
            std::fs::read_to_string(artifact.join("kickstart/kickstart.json"))?,
        )]),
    )?;
    super::super::sdk_webhook::ensure_keys(&instance)?;
    let key = artifact.join("sdk-webhook/id_ed25519.pub");
    secret(
        state,
        &namespace,
        "sdk-webhook-keys",
        &BTreeMap::from([(
            "sdk-webhook".into(),
            if key.is_file() {
                std::fs::read_to_string(key)?
            } else {
                String::new()
            },
        )]),
    )?;
    Ok(())
}

pub(super) fn normalize(env: &mut BTreeMap<String, String>) {
    let hosts = [
        "connection_gateway",
        "contacts_service",
        "document_storage_service",
        "email_service",
        "notification_service",
        "unfurl_service",
        "image_proxy_service",
        "agent_harness_service",
        "search_processing_service",
        "static_file_service",
        "authentication_service",
    ];
    for value in env.values_mut() {
        for host in hosts {
            *value = value.replace(
                &format!("://{host}:"),
                &format!("://{}:", host.replace('_', "-")),
            );
        }
    }
}

fn secret(
    state: &Path,
    namespace: &str,
    name: &str,
    values: &BTreeMap<String, String>,
) -> Result<()> {
    let data: BTreeMap<_, _> = values
        .iter()
        .map(|(key, value)| (key, STANDARD.encode(value)))
        .collect();
    let object = json!({"apiVersion":"v1", "kind":"Secret", "metadata":{"name":name,"namespace":namespace},"type":"Opaque", "data":data});
    kube(
        state,
        &[
            "apply",
            "--server-side",
            "--field-manager=macro-kube-secrets",
            "-f",
            "-",
        ],
        Some(&object),
    )?;
    Ok(())
}
