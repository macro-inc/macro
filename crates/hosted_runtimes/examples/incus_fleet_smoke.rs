//! Drive one throwaway computer through `IncusFleet` on a dev Incus host:
//! create → freeze → unfreeze → suspend → resume → destroy, timing each step.
//!
//! ```sh
//! cargo run -p hosted_runtimes --example incus_fleet_smoke -- \
//!   --url https://localhost:18443 \
//!   --control-plane-id smoke \
//!   --client-cert ~/.config/macro-computers/dev-client.crt \
//!   --client-key ~/.config/macro-computers/dev-client.key \
//!   --server-cert server.crt \
//!   --image macro-box --profile macro-box --storage-pool default \
//!   --reserve-gb 4 --oversell-factor 3 \
//!   --request-timeout-secs 90 --connect-timeout-secs 10 \
//!   --operation-wait-secs 60 --operation-waits 15 \
//!   --state-change-timeout-secs 60 --shutdown-grace-secs 60
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
use hosted_runtimes::domain::{
    enrollment::DeviceSecret,
    ids::{ComputerId, HostId, PairingId},
    models::ComputerName,
};
use hosted_runtimes::outbound::incus_fleet::{IncusFleet, IncusFleetConfig, instance_name};
use incus_client::{
    ImageProtocol, ImageReference, ImageRemote, ImageSource, IncusEndpoint, IncusTimeouts,
};
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
    #[arg(long)]
    image: String,
    /// A simplestreams server to fetch `--image` from, e.g.
    /// `https://images.linuxcontainers.org` with `--image ubuntu/24.04`.
    #[arg(long)]
    image_server: Option<String>,
    #[arg(long)]
    profile: String,
    #[arg(long)]
    storage_pool: String,
    #[arg(long)]
    reserve_gb: u32,
    #[arg(long)]
    oversell_factor: u32,
    #[arg(long)]
    request_timeout_secs: u64,
    #[arg(long)]
    connect_timeout_secs: u64,
    #[arg(long)]
    operation_wait_secs: u32,
    #[arg(long)]
    operation_waits: u32,
    #[arg(long)]
    state_change_timeout_secs: u32,
    #[arg(long)]
    shutdown_grace_secs: u64,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let endpoint = IncusEndpoint {
        url: args.url,
        timeouts: IncusTimeouts {
            request: std::time::Duration::from_secs(args.request_timeout_secs),
            connect: std::time::Duration::from_secs(args.connect_timeout_secs),
            operation_wait_secs: args.operation_wait_secs,
            operation_waits: args.operation_waits,
            state_change_secs: args.state_change_timeout_secs,
        },
        client_cert_pem: std::fs::read_to_string(&args.client_cert)?,
        client_key_pem: std::fs::read_to_string(&args.client_key)?,
        server_cert_pem: std::fs::read_to_string(&args.server_cert)?,
    };
    let config = IncusFleetConfig {
        image: ImageSource {
            reference: ImageReference::Alias(incus_client::ImageAlias::try_new(&args.image)?),
            remote: args.image_server.map(|server| ImageRemote {
                server,
                protocol: ImageProtocol::Simplestreams,
            }),
        },
        profile: incus_client::ProfileName::try_new(&args.profile)?,
        endpoint,
        host_name: "smoke".to_owned(),
        control_plane_id: ControlPlaneId::parse(args.control_plane_id)?,
        reserve_gb: args.reserve_gb,
        oversell_factor: args.oversell_factor,
        storage_pool: incus_client::StoragePoolName::try_new(&args.storage_pool)?,
        shutdown_grace: std::time::Duration::from_secs(args.shutdown_grace_secs),
    };
    let fleet = IncusFleet::new(config)?;

    let now = Utc::now();
    let mut computer = Computer {
        id: ComputerId::new_from_uuid(Uuid::now_v7()),
        team_id: Uuid::now_v7(),
        name: ComputerName::try_new("fleet smoke test")?,
        size: ComputerSize::Standard,
        resources: hosted_runtimes::domain::size::ComputerResources {
            vcpus: hosted_runtimes::domain::size::Vcpus::new(4),
            memory_gib: hosted_runtimes::domain::size::MemoryGib::new(8),
            disk_gib: hosted_runtimes::domain::size::DiskGib::new(100),
        },
        catalog_entry: hosted_runtimes::domain::size::CatalogEntryId::try_new(
            "standard@2026-11".to_owned(),
        )?,
        price_id: Some(hosted_runtimes::domain::models::StripePriceId::parse(
            "price_standard",
        )?),
        state: ComputerState::reserved(HostId::new(Uuid::now_v7()), now),
        harness_id: None,
        persona: None,
        created_by: macro_user_id::user_id::MacroUserIdStr::try_from(
            "macro|smoke@example.com".to_owned(),
        )?,
        created_at: now,
        enrolled_at: None,
        enrollment_generation: Default::default(),
    };
    computer.state.phase = hosted_runtimes::domain::lifecycle::Phase::Provisioning {
        host: HostId::new(Uuid::now_v7()),
        start: true,
    };
    let enrollment = Enrollment {
        computer_id: computer.id,
        generation: hosted_runtimes::domain::persona_credentials::EnrollmentGeneration::new(1),
        pairing_id: PairingId::new_from_uuid(Uuid::now_v7()),
        device_secret: DeviceSecret::new("smoke-test-not-a-secret".to_owned()),
        name: computer.name.clone(),
        service_url_overrides: BTreeMap::new(),
        persona: None,
        persona_enrollment: Default::default(),
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
    fleet
        .create(
            computer,
            enrollment.generation,
            &SmokeEnrollment(enrollment.clone()),
            true,
        )
        .await?;
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

async fn print_status(fleet: &IncusFleet, id: ComputerId) -> Result<(), rootcause::Report> {
    let status = fleet
        .instances()
        .await?
        .into_iter()
        .find(|instance| instance.computer_id == id)
        .map(|instance| instance.status);
    println!("  -> {status:?}");
    Ok(())
}

struct SmokeEnrollment(Enrollment);
impl hosted_runtimes::domain::ports::FleetEnrollment for SmokeEnrollment {
    async fn claimed(
        &self,
        _pairing: PairingId,
    ) -> Result<bool, hosted_runtimes::domain::persona_credentials::PersonaCredentialError> {
        Ok(false)
    }
    async fn issue(
        &self,
    ) -> Result<Enrollment, hosted_runtimes::domain::persona_credentials::PersonaCredentialError>
    {
        Ok(self.0.clone())
    }
}
