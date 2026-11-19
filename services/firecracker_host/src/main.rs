//! `firecracker-host serve --config <file>`: the Firecracker host agent.
//! `firecracker-host client --endpoint <file> <request>`: call one.

use std::path::PathBuf;
use std::sync::Arc;

use clap::{Parser, Subcommand};
use firecracker_host::config::Config;
use firecracker_host::config::DiskStorage;
use firecracker_host::domain::model::Slot;
use firecracker_host::domain::moves::MoveService;
use firecracker_host::domain::service::{HostService, ServiceSettings};
use firecracker_host::inbound;
use firecracker_host::outbound::cgroup;
use firecracker_host::outbound::disks::{Containers, FileDisks};
use firecracker_host::outbound::goldens::GoldenBuilds;
use firecracker_host::outbound::host_checks::HostChecks;
use firecracker_host::outbound::jails::{JailSettings, Jails};
use firecracker_host::outbound::layout::Layout;
use firecracker_host::outbound::network::Network;
use firecracker_host::outbound::probe::ProcProbe;
use firecracker_host::outbound::replication::{TcpPeers, ZfsReplicas};
use firecracker_host::outbound::store::FileStore;
use firecracker_host::outbound::zfs::Datasets;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::service::TowerToHyperService;
use macro_entrypoint::MacroEntrypoint;
use rootcause::Report;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// How long requests in flight may finish after a stop signal: a
/// hibernation of a large VM takes tens of seconds. Whatever is still
/// running then is cut off, and the next start reconciles it.
const SHUTDOWN_GRACE: std::time::Duration = std::time::Duration::from_secs(45);

#[derive(Parser)]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the agent.
    Serve {
        /// The TOML configuration.
        #[arg(long)]
        config: PathBuf,
        /// Kill the agent with SIGKILL when it reaches this point (crash
        /// harness builds only).
        #[cfg(feature = "crash-points")]
        #[arg(long, value_enum)]
        crash_at: Option<firecracker_host::crash_point::CrashPoint>,
    },
    /// Call an agent.
    Client {
        /// TOML with `url`, `client_certificate`, `client_key` and
        /// `server_certificate` (PEM paths).
        #[arg(long)]
        endpoint: PathBuf,
        #[command(subcommand)]
        command: inbound::cli::ClientCommand,
    },
}

/// The agent's source commit, when the build set `FIRECRACKER_HOST_COMMIT`.
const AGENT_VERSION: Option<&str> = option_env!("FIRECRACKER_HOST_COMMIT");

fn main() -> Result<(), Report> {
    let Arguments { command } = Arguments::parse();
    let config = match command {
        #[cfg(not(feature = "crash-points"))]
        Command::Serve { config } => config,
        #[cfg(feature = "crash-points")]
        Command::Serve { config, crash_at } => {
            if let Some(point) = crash_at {
                firecracker_host::crash_point::arm(point);
            }
            config
        }
        Command::Client { endpoint, command } => {
            rustls::crypto::aws_lc_rs::default_provider()
                .install_default()
                .map_err(|_| {
                    rootcause::report!("a rustls crypto provider was already installed")
                })?;
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            let code = runtime.block_on(inbound::cli::run(endpoint, command))?;
            std::process::exit(code);
        }
    };
    let config = Config::load(&config)?;
    // Slots plus the golden slot run as uid_base + 0..=slots.
    let taken = firecracker_host::config::ids_taken(
        config.jail.uid_base,
        u32::from(config.network.slots) + 1,
    )?;
    if !taken.is_empty() {
        return Err(rootcause::report!(
            "jail.uid_base {} overlaps existing ids: {}",
            config.jail.uid_base,
            taken.join(", ")
        ));
    }

    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .map_err(|_| rootcause::report!("a rustls crypto provider was already installed"))?;
    let environment = macro_env::Environment::new_from_env()?;

    // Before any thread starts: the move into `<unit>/agent` takes the
    // whole process, but a clear order keeps it obvious.
    let cgroup_parent = cgroup::set_up()?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    // The OTLP exporter needs a runtime to be built in.
    let entrypoint = {
        let _runtime = runtime.enter();
        MacroEntrypoint::new(environment).init()
    };
    let result = runtime.block_on(serve(config, cgroup_parent));
    entrypoint.shutdown();
    result
}

async fn serve(config: Config, cgroup_parent: String) -> Result<(), Report> {
    let zfs_dataset = match &config.storage.disks {
        DiskStorage::Zfs { dataset } => Some(dataset.clone()),
        DiskStorage::Xfs { .. } => None,
    };
    let (root, containers) = match &config.storage.disks {
        DiskStorage::Xfs { directory } => (directory.clone(), Containers::Xfs),
        DiskStorage::Zfs { dataset } => {
            let (datasets, mountpoint) = Datasets::open(dataset).await?;
            (mountpoint, Containers::Zfs(datasets))
        }
    };
    let layout = Layout::new(root.clone(), config.storage.images_dir.clone());
    let slots = config.network.slots;
    // One slot past the computers' is the golden builds'.
    let network = Network::new(
        config.network.clone(),
        config.listen.port(),
        config.jail.uid_base,
    );
    network.set_up(slots + 1).await?;

    let tasks = TaskTracker::new();
    let jails = Jails::new(JailSettings {
        layout: layout.clone(),
        firecracker: config.binaries.firecracker.clone(),
        jailer: config.binaries.jailer.clone(),
        uid_base: config.jail.uid_base,
        cgroup_parent: cgroup_parent.clone(),
        memory_overhead_mib: config.jail.memory_overhead_mib,
        network_prefix: config.network.prefix.clone(),
        golden_slot: Slot(slots),
        shutdown_grace: config.guest.shutdown_grace,
        golden_boot_timeout: config.guest.golden_boot_timeout,
        guest_agent_timeout: config.guest.guest_agent_timeout,
    });
    let disks = FileDisks::new(
        layout.clone(),
        containers,
        config.storage.golden_root_disk_gib,
    );
    let goldens = GoldenBuilds::new(layout.clone(), jails.clone(), disks.clone(), tasks.clone());
    let service = HostService::start(
        FileStore::new(layout.clone()),
        disks,
        goldens,
        jails,
        ProcProbe { cgroup_parent },
        ServiceSettings {
            host_name: config.host_name.clone(),
            firecracker_version: config.binaries.firecracker_version.clone(),
            agent_version: AGENT_VERSION.map(str::to_owned),
            dns: config.network.dns.clone(),
            concurrent_launches: config.guest.concurrent_launches,
            slot_count: slots,
            move_address: config.moves.as_ref().map(|moves| moves.listen.to_string()),
        },
        tasks.clone(),
    )
    .await
    .map_err(|error| rootcause::report!("starting the host service: {error}"))?;
    // Before any VM runs long enough to swap.
    service.guard_guest_swap().await;
    let service = Arc::new(service);
    // Tracked by `tasks`: each finishes on its own, under its computer's lock.
    drop(service.resume_pending_restores());
    tasks.spawn({
        let service = Arc::clone(&service);
        async move {
            service.prepare_home_templates().await;
            service.refill_spares().await;
        }
    });
    let health = Arc::new(inbound::health::Health {
        service: Arc::clone(&service),
        checks: HostChecks {
            durable_dir: root,
            nft_tables: HostChecks::nft_tables_for(&config.network.prefix),
            zfs_dataset: zfs_dataset.clone(),
        },
    });
    let mut router = inbound::axum_router::host_router(inbound::axum_router::HostRouterState::new(
        Arc::clone(&service),
    ))
    .merge(inbound::health::router(Arc::clone(&health)));
    let shutdown = CancellationToken::new();
    if let (Some(moves_config), Some(dataset)) = (&config.moves, &zfs_dataset) {
        let moves = Arc::new(
            MoveService::start(
                Arc::clone(&service),
                ZfsReplicas::new(dataset),
                TcpPeers::new(moves_config.connect_timeout),
                tasks.clone(),
            )
            .await
            .map_err(|error| rootcause::report!("starting moves: {error}"))?,
        );
        router = router.merge(inbound::moves::router(Arc::clone(&moves)));
        let listen = moves_config.listen;
        let peer_tasks = tasks.clone();
        let peer_shutdown = shutdown.clone();
        tasks.spawn(async move {
            if let Err(error) =
                inbound::moves::serve_peers(moves, listen, peer_tasks, peer_shutdown).await
            {
                tracing::error!(error = %error, listen = %listen, "move listener failed");
            }
        });
    }

    let acceptor =
        tokio_rustls::TlsAcceptor::from(Arc::new(inbound::tls::server_config(&config.tls)?));
    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    tracing::info!(listen = %config.listen, "firecracker host agent listening");

    tasks.spawn({
        let shutdown = shutdown.clone();
        async move {
            macro_entrypoint::shutdown_signal().await;
            tracing::info!("stop signal: draining requests in flight");
            shutdown.cancel();
        }
    });
    tasks.spawn(inbound::upkeep::run_activity(
        Arc::clone(&health.service),
        shutdown.clone(),
    ));
    tasks.spawn(inbound::upkeep::run_squeeze(
        Arc::clone(&health.service),
        shutdown.clone(),
    ));
    tasks.spawn(inbound::upkeep::run(health, shutdown.clone()));

    loop {
        let (stream, peer) = tokio::select! {
            () = shutdown.cancelled() => break,
            accepted = listener.accept() => match accepted {
                Ok(accepted) => accepted,
                Err(error) => {
                    tracing::warn!(error = %error, "accept failed");
                    continue;
                }
            },
        };
        let acceptor = acceptor.clone();
        let router = router.clone();
        let shutdown = shutdown.clone();
        tasks.spawn(async move {
            let stream = match acceptor.accept(stream).await {
                Ok(stream) => stream,
                Err(error) => {
                    tracing::warn!(peer = %peer, error = %error, "TLS handshake refused");
                    return;
                }
            };
            let builder = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new());
            let connection = builder.serve_connection_with_upgrades(
                TokioIo::new(stream),
                TowerToHyperService::new(router),
            );
            let mut connection = std::pin::pin!(connection);
            // On a stop signal the connection takes no new requests, but the
            // ones in flight finish: dropping one mid-operation would leave
            // a launch or hibernation for the next start to reconcile.
            let result = tokio::select! {
                result = connection.as_mut() => result,
                () = shutdown.cancelled() => {
                    connection.as_mut().graceful_shutdown();
                    connection.await
                }
            };
            if let Err(error) = result {
                tracing::debug!(peer = %peer, error = %error, "connection ended");
            }
        });
    }

    // VMs keep running: they are not the agent's children, and the unit
    // only kills the agent's own process. In-flight requests get a moment;
    // a golden build cut short is cleaned up by the next one.
    tasks.close();
    if tokio::time::timeout(SHUTDOWN_GRACE, tasks.wait())
        .await
        .is_err()
    {
        tracing::warn!("requests or golden builds still running at shutdown; leaving them");
    }
    Ok(())
}
