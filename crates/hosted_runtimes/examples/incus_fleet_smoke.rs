//! Drive one throwaway computer through `IncusFleet` on a dev Incus host:
//! create → stop → start → destroy, timing each step. Destroy also deletes
//! the computer's data volume.
//!
//! ```sh
//! cargo run -p hosted_runtimes --example incus_fleet_smoke -- \
//!   --url https://localhost:18443 \
//!   --control-plane-id smoke \
//!   --client-cert ~/.config/macro-computers/dev-client.crt \
//!   --client-key ~/.config/macro-computers/dev-client.key \
//!   --server-cert server.crt \
//!   --image macro-box/2026-11-10 --agent-image macro-box-agent/2026-11-10 \
//!   --profile macro-box --storage-pool default \
//!   --reserve-gb 4 --oversell-factor 3 \
//!   --request-timeout-secs 90 --connect-timeout-secs 10 \
//!   --operation-wait-secs 60 --operation-waits 15 \
//!   --state-change-timeout-secs 60 --shutdown-grace-secs 60
//! ```
//!
//! Without `--image-server` the images are the host's local `--image` and
//! `--agent-image` aliases, e.g. `macro-box/2026-11-10`. The smoke computer
//! runs no agent, so it is created from `--image`.

use std::path::PathBuf;
use std::time::Instant;

use chrono::Utc;
use clap::Parser;
use hosted_runtimes::domain::enrollment::Enrollment;
use hosted_runtimes::domain::image::GuestImages;
use hosted_runtimes::domain::lifecycle::{BillingPolicy, Context, Payment, provision};
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
    /// The agent-mode image beside `--image`, from the same server.
    #[arg(long)]
    agent_image: String,
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
        images: GuestImages {
            regular: args.image.as_str(),
            agent: args.agent_image.as_str(),
        }
        .try_map(|alias| {
            Ok::<_, incus_client::InvalidName>(ImageSource {
                reference: ImageReference::Alias(incus_client::ImageAlias::try_new(alias)?),
                remote: args.image_server.clone().map(|server| ImageRemote {
                    server,
                    protocol: ImageProtocol::Simplestreams,
                }),
            })
        })?,
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
    let host = HostId::new(Uuid::now_v7());
    let (state, _) = provision(
        Payment::Comped {
            reason: "fleet smoke test".to_owned(),
        },
        hosted_runtimes::domain::setup::SetupTimeline::started(now),
        None,
        Context {
            host,
            enrollment_generation: Default::default(),
            now,
            host_has_room: true,
            policy: BillingPolicy::from_days(14, 7)?,
        },
    );
    let computer = Computer {
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
        funding: hosted_runtimes::domain::models::Funding::Comped {
            reason: "fleet smoke test".to_owned(),
        },
        host,
        state,
        harness_id: None,
        created_by: macro_user_id::user_id::MacroUserIdStr::try_from(
            "macro|smoke@example.com".to_owned(),
        )?,
        created_at: now,
        enrolled_at: None,
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
        enrollment_generation: Default::default(),
    };
    let enrollment = Enrollment {
        computer_id: computer.id,
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration::new(1),
        pairing_id: PairingId::new_from_uuid(Uuid::now_v7()),
        device_secret: DeviceSecret::new("smoke-test-not-a-secret".to_owned()),
        name: computer.name.clone(),
        deployment: hosted_runtimes::domain::enrollment::Deployment {
            agent_harness_url: "https://dev-gateway.macro.com/agent-harness".parse()?,
            document_storage_url: "https://dev-gateway.macro.com/dss".parse()?,
            app_url: "https://dev.macro.com".parse()?,
            egress_url: "https://dev-gateway.macro.com/agent-harness-egress".parse()?,
        },
        traceparent: None,
        agent: None,
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
    let image = fleet
        .create(
            computer,
            enrollment.generation,
            &SmokeEnrollment(enrollment.clone()),
            true,
        )
        .await?;
    println!("create+start {:>8.1?} ({image})", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.stop(id).await?;
    println!("stop         {:>8.1?}", started.elapsed());
    print_status(fleet, id).await?;

    let started = Instant::now();
    fleet.start(id).await?;
    println!("start        {:>8.1?}", started.elapsed());
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
    ) -> Result<bool, hosted_runtimes::domain::enrollment::EnrollmentIssueError> {
        Ok(false)
    }
    async fn issue(
        &self,
    ) -> Result<Enrollment, hosted_runtimes::domain::enrollment::EnrollmentIssueError> {
        Ok(self.0.clone())
    }
}
