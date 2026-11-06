use super::*;

fn docker(args: &[&str]) -> Result<String> {
    output(Command::new("docker").args(args), None)
}

pub(super) fn ensure(state: &Path) -> Result<()> {
    // Two instances may start together; create shared cluster resources once.
    // The lock ends before either instance renders or applies its namespace.
    let lease = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(state.join("cluster.lock"))?;
    lease.lock()?;
    let root = super::super::repo_root();
    let owner = path_str(&root)?;
    if !state.join("tools").exists() {
        output(
            Command::new("nix")
                .current_dir(&root)
                .args(["build", ".#local-kubernetes-tools", "--out-link"])
                .arg(state.join("tools")),
            None,
        )?;
    }
    let networks = docker(&["network", "ls", "--format", "{{.Name}}"])?;
    if networks.lines().any(|name| name == NETWORK) {
        let network: Value = serde_json::from_str(&docker(&["network", "inspect", NETWORK])?)?;
        let legacy = root.join("infra/local/generated/kubernetes/owner.json");
        let legacy_owned = legacy.is_file()
            && serde_json::from_slice::<Value>(&std::fs::read(&legacy)?)? == owner
            && network[0]["Labels"]["macro.local.owner"] == "eks-deployments";
        ensure!(
            network[0]["Labels"]["macro.local.owner"] == owner || legacy_owned,
            "kind network belongs to another checkout"
        );
    } else {
        docker(&[
            "network",
            "create",
            "--subnet",
            "10.252.250.0/24",
            "--label",
            &format!("macro.local.owner={owner}"),
            NETWORK,
        ])?;
    }
    if !state.join("kubeconfig").exists() {
        let old = root.join("infra/local/generated/kubernetes");
        if old.join("kubeconfig").exists() {
            let recorded: Value = serde_json::from_slice(&std::fs::read(old.join("owner.json"))?)?;
            ensure!(
                recorded == owner,
                "legacy kubeconfig belongs to another checkout"
            );
            std::fs::copy(old.join("kubeconfig"), state.join("kubeconfig"))?;
        } else {
            let expr = format!(
                "let f = builtins.getFlake {}; in f.kubeLocal.clusterConfig {}",
                serde_json::to_string(&format!("git+file://{owner}"))?,
                serde_json::to_string(owner)?
            );
            let config = output(
                Command::new("nix").current_dir(&root).args([
                    "build",
                    "--impure",
                    "--no-link",
                    "--print-out-paths",
                    "--expr",
                    &expr,
                ]),
                None,
            )?;
            output(
                Command::new(state.join("tools/bin/kind"))
                    .env("KIND_EXPERIMENTAL_DOCKER_NETWORK", NETWORK)
                    .args([
                        "create",
                        "cluster",
                        "--name",
                        CLUSTER,
                        "--config",
                        config.trim(),
                        "--kubeconfig",
                    ])
                    .arg(state.join("kubeconfig"))
                    .args(["--wait", "180s"]),
                None,
            )?;
        }
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            state.join("kubeconfig"),
            std::fs::Permissions::from_mode(0o600),
        )?;
    }
    let node = format!("{CLUSTER}-control-plane");
    let info: Value = serde_json::from_str(&docker(&["inspect", &node])?)?;
    let kubeconfig: Value = serde_yaml::from_slice(&std::fs::read(state.join("kubeconfig"))?)?;
    let binding = &info[0]["NetworkSettings"]["Ports"]["6443/tcp"][0];
    let expected = format!(
        "https://127.0.0.1:{}",
        binding["HostPort"]
            .as_str()
            .context("owned API port missing")?
    );
    let context_name = format!("kind-{CLUSTER}");
    let context_cluster = kubeconfig["contexts"]
        .as_array()
        .context("kubeconfig contexts missing")?
        .iter()
        .find(|context| context["name"] == context_name)
        .and_then(|context| context["context"]["cluster"].as_str())
        .context("owned context missing")?;
    ensure!(
        kubeconfig["clusters"]
            .as_array()
            .is_some_and(|clusters| clusters
                .iter()
                .any(|cluster| cluster["name"] == context_cluster
                    && cluster["cluster"]["server"] == expected)),
        "kubeconfig does not point at the owned local node"
    );
    ensure!(
        info[0]["NetworkSettings"]["Networks"]
            .get(NETWORK)
            .is_some(),
        "node is not on this checkout's network"
    );
    ensure!(
        info[0]["Mounts"]
            .as_array()
            .context("node mounts missing")?
            .iter()
            .any(|mount| mount["Source"] == owner),
        "node does not mount this checkout's binaries"
    );
    kube(state, &["get", "nodes"], None)?;
    let containers = docker(&["ps", "-a", "--format", "{{.Names}}"])?;
    if containers.lines().any(|name| name == REGISTRY) {
        let info: Value = serde_json::from_str(&docker(&["inspect", REGISTRY])?)?;
        ensure!(
            info[0]["Config"]["Labels"]["macro.local.owner"] == owner,
            "registry belongs to another checkout"
        );
        docker(&["start", REGISTRY])?;
    } else {
        docker(&[
            "run",
            "-d",
            "--restart=unless-stopped",
            "--name",
            REGISTRY,
            "--network",
            NETWORK,
            "--label",
            &format!("macro.local.owner={owner}"),
            "-p",
            "127.0.0.1:32550:5000",
            "registry:2",
        ])?;
    }
    // Only this explicitly owned node learns the local registry mirror.
    docker(&[
        "exec",
        &node,
        "mkdir",
        "-p",
        "/etc/containerd/certs.d/localhost:32550",
    ])?;
    // The configuration is fixed public registry routing, never Secret data.
    docker(&[
        "exec",
        &node,
        "sh",
        "-ec",
        "printf '%s\\n' 'server = \"http://localhost:32550\"' '[host.\"http://macro-eks-registry:5000\"]' '  capabilities = [\"pull\", \"resolve\"]' > /etc/containerd/certs.d/localhost:32550/hosts.toml",
    ])?;
    Ok(())
}

/// Reject paths that the declared node cannot expose at the same location.
pub(super) fn check_binary_mount(params: &Value) -> Result<()> {
    let Some(path) = params["devBinaries"].as_str() else {
        return Ok(());
    };
    let info: Value =
        serde_json::from_str(&docker(&["inspect", &format!("{CLUSTER}-control-plane")])?)?;
    ensure!(
        info[0]["Mounts"]
            .as_array()
            .is_some_and(|mounts| mounts.iter().any(|mount| {
                let Some(source) = mount["Source"].as_str() else {
                    return false;
                };
                mount["Destination"] == source && Path::new(path).starts_with(source)
            })),
        "binary directory is not mounted into this node; use this checkout or a Nix store output"
    );
    Ok(())
}
