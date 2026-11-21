//! Drive one throwaway computer through `FirecrackerFleet` against a
//! Firecracker host agent: create → exec → restart → stop → start → freeze →
//! unfreeze → hibernate → start → clear enrollment → destroy, timing each step.
//!
//! ```sh
//! cargo run -p hosted_runtimes --example firecracker_fleet_smoke -- \
//!   --url https://10.150.0.17:8444 \
//!   --control-plane-id smoke \
//!   --client-cert test-client.crt --client-key test-client.key \
//!   --server-cert server.crt \
//!   --image ci-ubuntu/2026-11-17 \
//!   --computer-id 01937a00-0000-7000-8000-0000000f0801
//! ```
//!
//! A create the host answers `goldenNotReady` (its golden is still being
//! built) is retried every `--golden-retry-secs` up to `--golden-retries`
//! times. `--exec-user root` runs the exec step as root (images without the
//! `macro` user).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use chrono::Utc;
use clap::Parser;
use hosted_runtimes::domain::enrollment::{DeviceSecret, Enrollment};
use hosted_runtimes::domain::ids::{ComputerId, HostId, PairingId};
use hosted_runtimes::domain::image::{GuestImage, GuestImages};
use hosted_runtimes::domain::lifecycle::{Billing, BillingPolicy, Context, provision};
use hosted_runtimes::domain::models::{Computer, ComputerName, ControlPlaneId};
use hosted_runtimes::domain::ports::{Fleet, FleetError, GuestProcess};
use hosted_runtimes::domain::size::ComputerSize;
use hosted_runtimes::outbound::firecracker_fleet::{
    FirecrackerFleet, FirecrackerFleetConfig, FirecrackerFleetError,
};
use tokio::io::AsyncReadExt;
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
    #[arg(long)]
    computer_id: Uuid,
    #[arg(long, default_value_t = 10)]
    connect_timeout_secs: u64,
    #[arg(long, default_value_t = 120)]
    request_timeout_secs: u64,
    #[arg(long, default_value_t = 15)]
    golden_retry_secs: u64,
    #[arg(long, default_value_t = 40)]
    golden_retries: u32,
    /// `macro` (the fleet port's user) or `root`.
    #[arg(long, default_value = "macro")]
    exec_user: String,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let args = Args::parse();
    let image = GuestImage::try_new(&args.image)?;
    let fleet = FirecrackerFleet::new(
        &firecracker_host_api::client::HostEndpoint {
            url: args.url.clone(),
            client_certificate_pem: std::fs::read_to_string(&args.client_cert)?,
            client_key_pem: zeroize::Zeroizing::new(std::fs::read_to_string(&args.client_key)?),
            server_certificate_pem: std::fs::read_to_string(&args.server_cert)?,
            connect_timeout: Duration::from_secs(args.connect_timeout_secs),
            request_timeout: Duration::from_secs(args.request_timeout_secs),
        },
        FirecrackerFleetConfig {
            control_plane_id: ControlPlaneId::try_new(&args.control_plane_id)?,
            images: GuestImages {
                regular: image.clone(),
                agent: image,
            },
            host_name: hosted_runtimes::domain::models::HostName::try_new("smoke")?,
        },
    )?;

    let now = Utc::now();
    let host = HostId::new(Uuid::now_v7());
    let (state, _) = provision(
        Billing::Comped {
            reason: "fleet smoke test".to_owned(),
        },
        hosted_runtimes::domain::setup::SetupTimeline::started(now),
        None,
        false,
        Context {
            host,
            enrollment_generation: Default::default(),
            now,
            host_has_room: true,
            policy: BillingPolicy::from_days(14, 7)?,
        },
    );
    let computer = Computer {
        id: ComputerId::new_from_uuid(args.computer_id),
        team_id: Uuid::now_v7(),
        name: ComputerName::try_new("fleet smoke test")?,
        size: ComputerSize::Standard,
        resources: hosted_runtimes::domain::size::ComputerResources {
            vcpus: hosted_runtimes::domain::size::Vcpus::new(2),
            memory_gib: hosted_runtimes::domain::size::MemoryGib::new(2),
            disk_gib: hosted_runtimes::domain::size::DiskGib::new(40),
        },
        catalog_entry: hosted_runtimes::domain::size::CatalogEntryId::try_new(
            "smoke@2026-11".to_owned(),
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
        hibernated_at: None,
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
            telemetry_url: None,
        },
        traceparent: None,
        role: hosted_runtimes::domain::enrollment::ComputerRole::Person,
    };
    println!("host {:?}", fleet.host().await?);

    let result = run(&fleet, &computer, &enrollment, &args).await;
    // Always clean up, even after a failed step.
    let started = Instant::now();
    let destroyed = fleet.destroy(computer.id).await;
    println!("destroy      {:>8.1?} {destroyed:?}", started.elapsed());
    let left: Vec<_> = fleet
        .instances()
        .await?
        .into_iter()
        .filter(|instance| instance.computer_id == computer.id)
        .collect();
    println!("left after destroy: {left:?}");
    result?;
    destroyed?;
    Ok(())
}

async fn run(
    fleet: &FirecrackerFleet,
    computer: &Computer,
    enrollment: &Enrollment,
    args: &Args,
) -> Result<(), rootcause::Report> {
    let id = computer.id;
    let started = Instant::now();
    let mut attempt = 0;
    let image = loop {
        match fleet
            .create(
                computer,
                enrollment.generation,
                &SmokeEnrollment(enrollment.clone()),
                true,
            )
            .await
        {
            Ok(image) => break image,
            Err(FirecrackerFleetError::Client(error))
                if error.code() == Some(firecracker_host_api::ErrorCode::GoldenNotReady)
                    && attempt < args.golden_retries =>
            {
                attempt += 1;
                println!("  golden not ready (attempt {attempt}): {error}");
                tokio::time::sleep(Duration::from_secs(args.golden_retry_secs)).await;
            }
            Err(error) => return Err(error.into()),
        }
    };
    println!("create+start {:>8.1?} ({image})", started.elapsed());
    status(fleet, id).await?;

    // A retried create of the same generation completes without a new guest.
    let started = Instant::now();
    fleet
        .create(
            computer,
            enrollment.generation,
            &SmokeEnrollment(enrollment.clone()),
            true,
        )
        .await?;
    println!("create again {:>8.1?}", started.elapsed());

    let started = Instant::now();
    let process = match args.exec_user.as_str() {
        "root" => {
            fleet
                .exec_as_root(id, &["sh", "-c", "echo hi; id -u"])
                .await?
        }
        _ => fleet.exec(id, &["sh", "-c", "echo hi; id -u"]).await?,
    };
    let (code, stdout) = finish(process).await?;
    println!(
        "exec         {:>8.1?} exit {code} stdout {stdout:?}",
        started.elapsed()
    );

    println!(
        "resources match: {}",
        fleet.resources_match(computer).await?
    );

    for (name, step) in [
        ("restart", Step::Restart),
        ("stop", Step::Stop),
        ("start", Step::Start),
        ("freeze", Step::Freeze),
        ("unfreeze", Step::Unfreeze),
        ("hibernate", Step::Hibernate),
        ("start", Step::Start),
    ] {
        let started = Instant::now();
        match step {
            Step::Restart => fleet.restart(id).await?,
            Step::Stop => fleet.stop(id).await?,
            Step::Start => fleet.start(id).await?,
            Step::Freeze => fleet.freeze(id).await?,
            Step::Unfreeze => fleet.unfreeze(id).await?,
            Step::Hibernate => fleet.hibernate(id).await?,
        }
        println!("{name:<12} {:>8.1?}", started.elapsed());
        status(fleet, id).await?;
    }

    let started = Instant::now();
    fleet.clear_enrollment(id).await?;
    println!("clear enroll {:>8.1?}", started.elapsed());

    let missing = fleet
        .start(ComputerId::new_from_uuid(Uuid::now_v7()))
        .await
        .err()
        .is_some_and(|error| error.is_missing());
    println!("a missing guest reads as lost: {missing}");
    Ok(())
}

#[derive(Clone, Copy)]
enum Step {
    Restart,
    Stop,
    Start,
    Freeze,
    Unfreeze,
    Hibernate,
}

async fn finish(
    mut process: GuestProcess<FirecrackerFleetError>,
) -> Result<(i32, String), rootcause::Report> {
    drop(process.stdin);
    let mut stdout = String::new();
    let (read, exit) = tokio::join!(process.stdout.read_to_string(&mut stdout), process.exit);
    read?;
    Ok((exit?, stdout))
}

async fn status(fleet: &FirecrackerFleet, id: ComputerId) -> Result<(), rootcause::Report> {
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
