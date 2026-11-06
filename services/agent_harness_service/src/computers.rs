//! Macro computers' control plane in this process: the fleet operator and
//! its loops, macrod presence → lifecycle events, and waking an asleep
//! computer when a prompt is forwarded to its harness.
//!
//! Purchases, billing and the team routes live in authentication_service,
//! which owns Stripe; both share the `hosted_runtime*` tables.

use hosted_runtimes::domain::ids::{ComputerId, PairingId};

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_harness::domain::error::Result as HarnessResult;
use agent_harness::domain::model::{CommandOutcome, HarnessCommand};
use agent_harness::domain::ports::{CommandForwarder, CommandTarget, HarnessPresence};
use agent_session::domain::model::AgentSessionId;
use anyhow::Context;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use harnesses::domain::models::CreateHostedPairing;
use harnesses::domain::ports::{HarnessError, HarnessService};
use hosted_runtimes::domain::models::{Computer, ControlPlaneId, EnrollmentDefaults};
use hosted_runtimes::domain::operator::{ComputerOperator, SessionActivity};
use hosted_runtimes::domain::ports::{Harnesses, HostedPairing};
use hosted_runtimes::domain::service::SystemClock;
use hosted_runtimes::outbound::configured_fleet::ConfiguredFleet;
use hosted_runtimes::outbound::docker_fleet::{DockerFleet, DockerFleetConfig};
use hosted_runtimes::outbound::incus_fleet::{IncusFleet, IncusFleetConfig};
use hosted_runtimes::outbound::pg::PgComputerRepo;
use incus_client::{ImageReference, ImageSource, IncusEndpoint, IncusTimeouts};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

use crate::config::{Config, Environment};

const EFFECT_TICK: Duration = Duration::from_secs(2);
const TIMER_TICK: Duration = Duration::from_secs(5);
const RECONCILE_TICK: Duration = Duration::from_secs(60);
const IDLE_TICK: Duration = Duration::from_secs(60);
/// A parked prompt is forwarded anyway after this long, so a computer that
/// connects to another replica still gets it.
const PARK_LIMIT: Duration = Duration::from_secs(120);

pub type Operator = ComputerOperator<PgComputerRepo, ConfiguredFleet, HostedHarnesses, SystemClock>;

/// Build the operator from explicit config, or `None` when this deployment
/// runs no computers (`COMPUTERS_FLEET` unset).
pub async fn operator(
    config: &Config,
    pool: &PgPool,
    harnesses: Arc<dyn HostedHarnessService>,
) -> anyhow::Result<Option<Arc<Operator>>> {
    let Some(kind) = config.computers_fleet.as_deref() else {
        return Ok(None);
    };
    let control_plane_id = ControlPlaneId::parse(required(
        &config.computers_control_plane_id,
        "COMPUTERS_CONTROL_PLANE_ID",
    )?)?;
    let host_name = required(&config.computers_host_name, "COMPUTERS_HOST_NAME")?;

    let image = required(&config.computers_image, "COMPUTERS_IMAGE")?;
    let reserve_gb = required_value(
        &config.computers_host_reserve_gb,
        "COMPUTERS_HOST_RESERVE_GB",
    )?;
    let oversell_factor = required_value(
        &config.computers_oversell_factor,
        "COMPUTERS_OVERSELL_FACTOR",
    )?;
    anyhow::ensure!(
        oversell_factor > 0,
        "COMPUTERS_OVERSELL_FACTOR must be positive"
    );

    let fleet = match kind {
        "incus" => ConfiguredFleet::Incus(
            IncusFleet::new(IncusFleetConfig {
                endpoint: IncusEndpoint {
                    url: required(&config.computers_incus_url, "COMPUTERS_INCUS_URL")?,
                    timeouts: IncusTimeouts {
                        state_change_secs: required_value(
                            &config.computers_incus_state_change_timeout_secs,
                            "COMPUTERS_INCUS_STATE_CHANGE_TIMEOUT_SECS",
                        )?,
                        request: Duration::from_secs(required_value(
                            &config.computers_incus_request_timeout_secs,
                            "COMPUTERS_INCUS_REQUEST_TIMEOUT_SECS",
                        )?),
                        connect: Duration::from_secs(required_value(
                            &config.computers_incus_connect_timeout_secs,
                            "COMPUTERS_INCUS_CONNECT_TIMEOUT_SECS",
                        )?),
                        operation_wait_secs: required_value(
                            &config.computers_incus_operation_wait_secs,
                            "COMPUTERS_INCUS_OPERATION_WAIT_SECS",
                        )?,
                        operation_waits: required_value(
                            &config.computers_incus_operation_waits,
                            "COMPUTERS_INCUS_OPERATION_WAITS",
                        )?,
                    },
                    client_cert_pem: required(
                        &config.computers_incus_client_cert,
                        "COMPUTERS_INCUS_CLIENT_CERT",
                    )?,
                    client_key_pem: required(
                        &config.computers_incus_client_key,
                        "COMPUTERS_INCUS_CLIENT_KEY",
                    )?,
                    server_cert_pem: required(
                        &config.computers_incus_server_cert,
                        "COMPUTERS_INCUS_SERVER_CERT",
                    )?,
                },
                host_name,
                control_plane_id,
                reserve_gb,
                oversell_factor,
                image: ImageSource {
                    reference: ImageReference::Alias(incus_client::ImageAlias::try_new(&image)?),
                    remote: None,
                },
                profile: incus_client::ProfileName::try_new(&required(
                    &config.computers_incus_profile,
                    "COMPUTERS_INCUS_PROFILE",
                )?)?,
                storage_pool: incus_client::StoragePoolName::try_new(&required(
                    &config.computers_incus_storage_pool,
                    "COMPUTERS_INCUS_STORAGE_POOL",
                )?)?,
                shutdown_grace: Duration::from_secs(required_value(
                    &config.computers_incus_shutdown_grace_secs,
                    "COMPUTERS_INCUS_SHUTDOWN_GRACE_SECS",
                )?),
            })
            .context("could not build the Incus fleet")?,
        ),
        "docker" => ConfiguredFleet::Docker(
            DockerFleet::new(
                DockerFleetConfig {
                    control_plane_id,
                    image,
                    network: required(
                        &config.computers_docker_network,
                        "COMPUTERS_DOCKER_NETWORK",
                    )?,
                    enrollment_dir: required(
                        &config.computers_docker_enrollment_dir,
                        "COMPUTERS_DOCKER_ENROLLMENT_DIR",
                    )?
                    .into(),
                    host_name,
                    memory_gb: required_value(
                        &config.computers_docker_memory_gb,
                        "COMPUTERS_DOCKER_MEMORY_GB",
                    )?,
                    reserve_gb,
                    oversell_factor,
                },
                config.environment,
            )
            .context("could not build the Docker fleet")?,
        ),
        other => anyhow::bail!("COMPUTERS_FLEET must be incus or docker, not {other:?}"),
    };

    let service_url_overrides = service_url_overrides(config)?;

    let operator = ComputerOperator::start(
        PgComputerRepo::new(pool.clone()),
        fleet,
        HostedHarnesses { service: harnesses },
        SystemClock,
        EnrollmentDefaults {
            service_url_overrides,
        },
    )
    .await
    .map_err(|error| anyhow::anyhow!("computer operator failed to start: {error}"))?;
    Ok(Some(Arc::new(operator)))
}

pub(super) fn service_url_overrides(config: &Config) -> anyhow::Result<BTreeMap<String, String>> {
    let service_url_overrides: BTreeMap<String, String> =
        match config.computers_service_url_overrides.as_deref() {
            Some(json) => serde_json::from_str(json)
                .context("COMPUTERS_SERVICE_URL_OVERRIDES must be a JSON object of strings")?,
            None => BTreeMap::new(),
        };
    if !service_url_overrides.is_empty() && !matches!(config.environment, Environment::Local) {
        anyhow::bail!("COMPUTERS_SERVICE_URL_OVERRIDES is for local stacks only");
    }

    Ok(service_url_overrides)
}

fn required(value: &Option<String>, name: &str) -> anyhow::Result<String> {
    value
        .clone()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required when COMPUTERS_FLEET is set"))
}

fn required_value<T: Copy>(value: &Option<T>, name: &str) -> anyhow::Result<T> {
    value
        .as_ref()
        .copied()
        .with_context(|| format!("{name} is required when COMPUTERS_FLEET is set"))
}

/// The operator's periodic passes.
#[derive(Debug, Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Pass {
    Effects,
    Timers,
    Reconcile,
    SleepIdle,
}

impl Pass {
    fn tick(self) -> Duration {
        match self {
            Self::Effects => EFFECT_TICK,
            Self::Timers => TIMER_TICK,
            Self::Reconcile => RECONCILE_TICK,
            Self::SleepIdle => IDLE_TICK,
        }
    }
}

/// Run the operator's passes until `shutdown`.
pub fn spawn_loops(
    operator: Arc<Operator>,
    activity: PgSessionActivity,
    tracker: &TaskTracker,
    shutdown: CancellationToken,
) {
    for pass in [
        Pass::Effects,
        Pass::Timers,
        Pass::Reconcile,
        Pass::SleepIdle,
    ] {
        tracker.spawn(run_pass(
            pass,
            Arc::clone(&operator),
            activity.clone(),
            shutdown.clone(),
        ));
    }
}

async fn run_pass(
    pass: Pass,
    operator: Arc<Operator>,
    activity: PgSessionActivity,
    shutdown: CancellationToken,
) {
    let mut interval = tokio::time::interval(pass.tick());
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = shutdown.cancelled() => return,
            _ = interval.tick() => {}
        }
        let outcome = match pass {
            Pass::Effects => operator.run_fleet_effects().await.map(|_| ()),
            Pass::Timers => operator.fire_timers().await.map(|_| ()),
            Pass::Reconcile => operator.reconcile().await,
            Pass::SleepIdle => operator.sleep_idle(&activity).await.map(|_| ()),
        };
        if let Err(error) = outcome {
            let name: &'static str = pass.into();
            tracing::error!(pass = name, error = ?error, "computer pass failed");
        }
    }
}

/// The slice of [`HarnessService`] the control plane uses; object-safe so
/// the composition root can hand over its existing service.
pub trait HostedHarnessService: Send + Sync + 'static {
    fn create_hosted_pairing(
        &self,
        request: CreateHostedPairing,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<harnesses::domain::models::HostedPairing, HarnessError>>
                + Send
                + '_,
        >,
    >;

    fn revoke_hosted_harness(
        &self,
        computer_id: Uuid,
    ) -> Pin<Box<dyn Future<Output = Result<(), HarnessError>> + Send + '_>>;

    fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Uuid>, HarnessError>> + Send + '_>>;
}

impl<Service: HarnessService + Send + Sync + 'static> HostedHarnessService for Service {
    fn create_hosted_pairing(
        &self,
        request: CreateHostedPairing,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<harnesses::domain::models::HostedPairing, HarnessError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(HarnessService::create_hosted_pairing(self, request))
    }

    fn revoke_hosted_harness(
        &self,
        computer_id: Uuid,
    ) -> Pin<Box<dyn Future<Output = Result<(), HarnessError>> + Send + '_>> {
        Box::pin(HarnessService::revoke_hosted_harness(
            self,
            computer_id::ComputerId::new_from_uuid(computer_id),
        ))
    }

    fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Uuid>, HarnessError>> + Send + '_>> {
        Box::pin(async move {
            Ok(HarnessService::harness_computer(self, harness_id)
                .await?
                .map(computer_id::ComputerId::as_uuid))
        })
    }
}

/// [`Harnesses`] over the harnesses crate: a computer's harness is a team
/// harness born approved, so macrod claims it without a pairing code.
pub struct HostedHarnesses {
    service: Arc<dyn HostedHarnessService>,
}

#[derive(Debug, thiserror::Error)]
pub enum HostedHarnessError {
    #[error(transparent)]
    Harness(#[from] HarnessError),
    #[error("the computer's buyer is not a valid user id: {0}")]
    InvalidBuyer(String),
}

impl Harnesses for HostedHarnesses {
    type Err = HostedHarnessError;

    async fn create_hosted_pairing(&self, computer: &Computer) -> Result<HostedPairing, Self::Err> {
        let created_by = MacroUserIdStr::try_from(computer.created_by.clone())
            .map_err(|_| HostedHarnessError::InvalidBuyer(computer.created_by.clone()))?;
        let pairing = self
            .service
            .create_hosted_pairing(CreateHostedPairing {
                team_id: computer.team_id,
                name: computer.name.as_str().to_owned(),
                created_by,
                // The computer is the team's own isolated VM, run for agents.
                allow_permission_bypass: true,
                computer_id: computer_id::ComputerId::new_from_uuid(computer.id.into_inner()),
            })
            .await?;
        Ok(HostedPairing {
            pairing_id: PairingId::new(pairing.pairing_id.as_uuid()),
            device_secret: hosted_runtimes::domain::enrollment::DeviceSecret::new(
                pairing.device_secret.expose().to_owned(),
            ),
        })
    }

    async fn computer_for(&self, harness_id: HarnessId) -> Result<Option<ComputerId>, Self::Err> {
        Ok(self
            .service
            .harness_computer(harness_id)
            .await?
            .map(ComputerId::new))
    }

    async fn revoke(&self, computer_id: ComputerId) -> Result<(), Self::Err> {
        Ok(self
            .service
            .revoke_hosted_harness(computer_id.into_inner())
            .await?)
    }
}

/// Session quiet-ness over the agent session tables.
#[derive(Clone)]
pub struct PgSessionActivity {
    pool: PgPool,
}

impl PgSessionActivity {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl SessionActivity for PgSessionActivity {
    type Err = sqlx::Error;

    async fn is_idle_since(
        &self,
        harness_id: HarnessId,
        since: DateTime<Utc>,
    ) -> Result<bool, sqlx::Error> {
        let busy = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM agent_session s
                JOIN agent_configs ac ON ac.bot_id = s.bot_id
                WHERE ac.harness_id = $1
                  AND NOT s.is_archived
                  AND (s.turn_state = 'running' OR s.modified_at > $2)
            ) AS "busy!"
            "#,
            harness_id.as_uuid(),
            since,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(!busy)
    }
}

/// Commands held for computers that are waking, by harness.
#[derive(Default)]
pub struct ParkedCommands {
    commands: Mutex<HashMap<HarnessId, Vec<(AgentSessionId, HarnessCommand)>>>,
}

impl ParkedCommands {
    fn park(&self, harness: HarnessId, session: AgentSessionId, command: HarnessCommand) {
        if let Ok(mut commands) = self.commands.lock() {
            commands
                .entry(harness)
                .or_default()
                .push((session, command));
        }
    }

    fn take(&self, harness: HarnessId) -> Vec<(AgentSessionId, HarnessCommand)> {
        self.commands
            .lock()
            .map(|mut commands| commands.remove(&harness).unwrap_or_default())
            .unwrap_or_default()
    }
}

/// Forwards like `Inner`, but a command for an asleep computer wakes it and
/// waits (parked) until its macrod connects, instead of being broadcast to
/// replicas none of which holds the harness.
pub struct WakingForwarder<Inner> {
    inner: Arc<Inner>,
    operator: Option<Arc<Operator>>,
    parked: Arc<ParkedCommands>,
}

impl<Inner> WakingForwarder<Inner> {
    pub fn new(
        inner: Arc<Inner>,
        operator: Option<Arc<Operator>>,
        parked: Arc<ParkedCommands>,
    ) -> Self {
        Self {
            inner,
            operator,
            parked,
        }
    }
}

impl<Inner: CommandForwarder> CommandForwarder for WakingForwarder<Inner> {
    async fn forward(
        &self,
        session: AgentSessionId,
        command: HarnessCommand,
        target: CommandTarget,
    ) -> HarnessResult<CommandOutcome> {
        if let (Some(operator), CommandTarget::Harness(harness)) = (&self.operator, &target) {
            let must_wait = operator
                .prompt_arrived(*harness)
                .await
                .inspect_err(
                    |error| tracing::error!(%harness, error = ?error, "could not wake a computer"),
                )
                .unwrap_or(false);
            if must_wait {
                tracing::info!(%harness, %session, "parking a command until the computer wakes");
                self.parked.park(*harness, session, command);
                let inner = Arc::clone(&self.inner);
                let parked = Arc::clone(&self.parked);
                let harness = *harness;
                tokio::spawn(async move {
                    tokio::time::sleep(PARK_LIMIT).await;
                    flush(&*inner, &parked, harness).await;
                });
                return Ok(CommandOutcome::Queued);
            }
        }
        self.inner.forward(session, command, target).await
    }
}

async fn flush<Inner: CommandForwarder>(
    inner: &Inner,
    parked: &ParkedCommands,
    harness: HarnessId,
) {
    for (session, command) in parked.take(harness) {
        inner
            .forward(session, command, CommandTarget::Harness(harness))
            .await
            .inspect_err(|error| tracing::error!(%harness, %session, error = ?error, "parked command failed"))
            .ok();
    }
}

/// [`HarnessPresence`] that also tells the operator, and releases commands
/// parked for the harness once it is connected.
pub struct ComputerPresence<Inner, Forwarder> {
    inner: Arc<Inner>,
    operator: Option<Arc<Operator>>,
    forwarder: Arc<Forwarder>,
    parked: Arc<ParkedCommands>,
}

impl<Inner, Forwarder> ComputerPresence<Inner, Forwarder> {
    pub fn new(
        inner: Arc<Inner>,
        operator: Option<Arc<Operator>>,
        forwarder: Arc<Forwarder>,
        parked: Arc<ParkedCommands>,
    ) -> Self {
        Self {
            inner,
            operator,
            forwarder,
            parked,
        }
    }
}

impl<Inner, Forwarder> HarnessPresence for ComputerPresence<Inner, Forwarder>
where
    Inner: HarnessPresence,
    Forwarder: CommandForwarder,
{
    fn connected(self: Arc<Self>, harness: HarnessId) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            Arc::clone(&self.inner).connected(harness).await;
            if let Some(operator) = &self.operator {
                operator
                    .macrod_connected(harness)
                    .await
                    .inspect_err(|error| tracing::error!(%harness, error = ?error, "computer connect event failed"))
                    .ok();
            }
            flush(&*self.forwarder, &self.parked, harness).await;
        })
    }

    fn disconnected(
        self: Arc<Self>,
        harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            Arc::clone(&self.inner).disconnected(harness).await;
            if let Some(operator) = &self.operator {
                operator
                    .macrod_disconnected(harness)
                    .await
                    .inspect_err(|error| tracing::error!(%harness, error = ?error, "computer disconnect event failed"))
                    .ok();
            }
        })
    }
}
