//! Drive one throwaway computer through `IncusFleet` on a dev Incus host:
//! create → freeze → unfreeze → suspend → resume → destroy, timing each step.
//!
//! ```sh
//! cargo run -p hosted_runtimes --example incus_fleet_smoke -- \
//!   --url https://localhost:18443 \
//!   --control-plane-id smoke \
//!   --client-cert ~/.config/macro-computers/dev-client.crt \
//!   --client-key ~/.config/macro-computers/dev-client.key \
//!   --server-cert runtime-dev-1-server.crt
//! ```
//!
//! Without `--image-server` the image is the host's local `--image` alias.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Instant;

use chrono::Utc;
use clap::Parser;
use hosted_runtimes::domain::enrollment::Enrollment;
use hosted_runtimes::domain::lifecycle::ComputerState;
use hosted_runtimes::domain::models::{Computer, ControlPlaneId};
use hosted_runtimes::domain::ports::Fleet;
use hosted_runtimes::domain::size::ComputerSize;
use hosted_runtimes::outbound::incus_fleet::{IncusFleet, IncusFleetConfig, instance_name};
use incus_client::{ImageProtocol, ImageReference, ImageRemote, ImageSource, IncusEndpoint};
use uuid::Uuid;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    url: String,
    #[arg(long)]
    control_plane_id: String,
    #[arg(long)]
    client_cert: PathBuf,
    #[arg(long)]
    client_key: PathBuf,
    #[arg(long)]
    server_cert: PathBuf,
    #[arg(long, default_value = "macro-box")]
    image: String,
    /// A simplestreams server to fetch `--image` from, e.g.
    /// `https://images.linuxcontainers.org` with `--image ubuntu/24.04`.
    #[arg(long)]
    image_server: Option<String>,
    #[arg(long, default_value = "macro-box")]
    profile: String,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let endpoint = IncusEndpoint {
        url: args.url,
        client_cert_pem: std::fs::read_to_string(&args.client_cert)?,
        client_key_pem: std::fs::read_to_string(&args.client_key)?,
        server_cert_pem: std::fs::read_to_string(&args.server_cert)?,
    };
    let config = IncusFleetConfig {
        image: ImageSource {
            reference: ImageReference::Alias(args.image),
            remote: args.image_server.map(|server| ImageRemote {
                server,
                protocol: ImageProtocol::Simplestreams,
            }),
        },
        profile: args.profile,
        ..IncusFleetConfig::macro_box(
            endpoint,
            "smoke".to_owned(),
            ControlPlaneId::parse(args.control_plane_id)?,
            4,
            3,
        )
    };
    let fleet = IncusFleet::new(config)?;

    let now = Utc::now();
    let computer = Computer {
        id: Uuid::now_v7(),
        team_id: Uuid::now_v7(),
        name: "fleet smoke test".to_owned(),
        size: ComputerSize::Standard,
        state: ComputerState::reserved(Uuid::now_v7(), now),
        harness_id: None,
        persona: None,
        created_by: "incus_fleet_smoke".to_owned(),
        created_at: now,
        enrolled_at: None,
    };
    let enrollment = Enrollment {
        computer_id: computer.id,
        pairing_id: Uuid::now_v7(),
        device_secret: "smoke-test-not-a-secret".to_owned(),
        name: computer.name.clone(),
        service_url_overrides: BTreeMap::new(),
        persona: None,
    };
    let id = computer.id;
    println!("instance {}", instance_name(id));
    println!("host {:?}", fleet.host().await?);

    let result = run(&fleet, &computer, &enrollment).await;
    // Always clean up, even after a failed step.
    let started = Instant::now();
    fleet.destroy(id).await?;
    println!("destroy      {:>8.1?}", started.elapsed());
    let left: Vec<_> = fleet
        .instances()
        .await?
        .into_iter()
        .filter(|instance| instance.computer_id == id)
        .collect();
    println!("left after destroy: {left:?}");
    result
}

async fn run(
    fleet: &IncusFleet,
    computer: &Computer,
    enrollment: &Enrollment,
) -> Result<(), rootcause::Report> {
    let id = computer.id;
    let started = Instant::now();
    fleet.create(computer, enrollment, true).await?;
    println!("create+start {:>8.1?}", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.freeze(id).await?;
    println!("freeze       {:>8.1?}", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.unfreeze(id).await?;
    println!("unfreeze     {:>8.1?}", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.suspend(id).await?;
    println!("suspend      {:>8.1?}", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.resume(id).await?;
    println!("resume       {:>8.1?}", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.clear_enrollment(id).await?;
    println!("clear enroll {:>8.1?}", started.elapsed());
    Ok(())
}

async fn print_status(fleet: &IncusFleet, id: Uuid) -> Result<(), rootcause::Report> {
    let status = fleet
        .instances()
        .await?
        .into_iter()
        .find(|instance| instance.computer_id == id)
        .map(|instance| instance.status);
    println!("  -> {status:?}");
    Ok(())
}
