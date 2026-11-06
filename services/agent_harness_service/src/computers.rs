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

use agent_harness::domain::error::{HarnessError as CommandError, Result as HarnessResult};
use agent_harness::domain::model::{CommandOutcome, HarnessCommand};
use agent_harness::domain::ports::{CommandForwarder, CommandTarget, HarnessPresence};
use agent_session::domain::model::AgentSessionId;
use anyhow::Context;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use harnesses::domain::models::CreateHostedPairing;
use harnesses::domain::ports::{HarnessError, HarnessService};
use hosted_runtimes::domain::models::{Computer, ControlPlaneId, EnrollmentDefaults};
use hosted_runtimes::domain::no_persona_credentials::NoPersonaCredentials;
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
use tracing::Instrument;
use uuid::Uuid;

use crate::config::{ComputerFleetConfig, Config};

const EFFECT_TICK: Duration = Duration::from_secs(2);
const TIMER_TICK: Duration = Duration::from_secs(5);
const RECONCILE_TICK: Duration = Duration::from_secs(60);
const IDLE_TICK: Duration = Duration::from_secs(60);
/// A parked prompt is forwarded anyway after this long, so a computer that
/// connects to another replica still gets it.
const PARK_LIMIT: Duration = Duration::from_secs(120);

pub type Operator = ComputerOperator<
    PgComputerRepo,
    ConfiguredFleet,
    HostedHarnesses,
    SystemClock,
    NoPersonaCredentials<PgComputerRepo>,
>;

/// Build the operator from explicit config, or `None` when this deployment
/// runs no computers (`COMPUTERS_FLEET=disabled`).
pub(crate) async fn operator(
    config: &Config,
    fleet_config: ComputerFleetConfig,
    pool: &PgPool,
    harnesses: Arc<dyn HostedHarnessService>,
) -> anyhow::Result<Option<Arc<Operator>>> {
    let fleet = match fleet_config {
        ComputerFleetConfig::Incus(settings) => ConfiguredFleet::Incus(
            IncusFleet::new(IncusFleetConfig {
                endpoint: IncusEndpoint {
                    url: settings.computers_incus_url.clone(),
                    timeouts: IncusTimeouts {
                        state_change_secs: settings.computers_incus_state_change_timeout_secs,
                        request: Duration::from_secs(settings.computers_incus_request_timeout_secs),
                        connect: Duration::from_secs(settings.computers_incus_connect_timeout_secs),
                        operation_wait_secs: settings.computers_incus_operation_wait_secs,
                        operation_waits: settings.computers_incus_operation_waits,
                    },
                    client_cert_pem: settings.computers_incus_client_cert.clone(),
                    client_key_pem: settings.computers_incus_client_key.clone(),
                    server_cert_pem: settings.computers_incus_server_cert.clone(),
                },
                host_name: settings.computers_host_name.clone(),
                control_plane_id: ControlPlaneId::parse(
                    settings.computers_control_plane_id.clone(),
                )?,
                reserve_gb: settings.computers_host_reserve_gb,
                oversell_factor: settings.computers_oversell_factor,
                image: ImageSource {
                    reference: ImageReference::Alias(incus_client::ImageAlias::try_new(
                        &settings.computers_image,
                    )?),
                    remote: None,
                },
                profile: incus_client::ProfileName::try_new(
                    &settings.computers_incus_profile.clone(),
                )?,
                storage_pool: incus_client::StoragePoolName::try_new(
                    &settings.computers_incus_storage_pool.clone(),
                )?,
                shutdown_grace: Duration::from_secs(settings.computers_incus_shutdown_grace_secs),
            })
            .context("could not build the Incus fleet")?,
        ),
        ComputerFleetConfig::Docker(settings) => ConfiguredFleet::Docker(
            DockerFleet::new(
                DockerFleetConfig {
                    control_plane_id: ControlPlaneId::parse(
                        settings.computers_control_plane_id.clone(),
                    )?,
                    image: settings.computers_image.clone(),
                    network: settings.computers_docker_network.clone(),
                    enrollment_dir: settings.computers_docker_enrollment_dir.clone().into(),
                    host_name: settings.computers_host_name.clone(),
                    memory_gb: settings.computers_docker_memory_gb,
                    reserve_gb: settings.computers_host_reserve_gb,
                    oversell_factor: settings.computers_oversell_factor,
                },
                config.environment,
            )
            .context("could not build the Docker fleet")?,
        ),
        ComputerFleetConfig::Disabled => return Ok(None),
    };

    let service_url_overrides = service_url_overrides()?;

    let operator = ComputerOperator::start(
        PgComputerRepo::new(pool.clone()),
        fleet,
        HostedHarnesses { service: harnesses },
        SystemClock,
        EnrollmentDefaults {
            service_url_overrides,
        },
        NoPersonaCredentials::new(PgComputerRepo::new(pool.clone())),
    )
    .await
    .map_err(|error| anyhow::anyhow!("computer operator failed to start: {error}"))?;
    Ok(Some(Arc::new(operator)))
}

pub(super) fn service_url_overrides() -> anyhow::Result<BTreeMap<String, String>> {
    use macro_service_urls::{
        AgentHarnessEgressUrl, AgentHarnessServiceUrl, AppServiceUrl, AuthServiceUrl,
        DocumentStorageServiceUrl,
    };

    let mut service_url_overrides = BTreeMap::new();
    for name in [
        AgentHarnessEgressUrl::OVERRIDE_ENV_VAR_NAME,
        AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME,
        AppServiceUrl::OVERRIDE_ENV_VAR_NAME,
        AuthServiceUrl::OVERRIDE_ENV_VAR_NAME,
        DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME,
    ] {
        if let Some(value) = macro_service_urls::read_override_env(name)? {
            service_url_overrides.insert(name.to_owned(), value);
        }
    }

    Ok(service_url_overrides)
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

    fn hosted_pairing_claimed(
        &self,
        pairing_id: PairingId,
    ) -> Pin<Box<dyn Future<Output = Result<bool, HarnessError>> + Send + '_>>;

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

    fn hosted_pairing_claimed(
        &self,
        pairing_id: PairingId,
    ) -> Pin<Box<dyn Future<Output = Result<bool, HarnessError>> + Send + '_>> {
        Box::pin(HarnessService::hosted_pairing_claimed(
            self,
            pairing_id::PairingId::new_from_uuid(pairing_id.into_inner()),
        ))
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

    async fn pairing_claimed(&self, pairing_id: PairingId) -> Result<bool, Self::Err> {
        Ok(self.service.hosted_pairing_claimed(pairing_id).await?)
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
    tracker: TaskTracker,
    shutdown: CancellationToken,
}

impl<Inner> WakingForwarder<Inner> {
    pub fn new(
        inner: Arc<Inner>,
        operator: Option<Arc<Operator>>,
        parked: Arc<ParkedCommands>,
        tracker: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            inner,
            operator,
            parked,
            tracker,
            shutdown,
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
                .map_err(|error| {
                    CommandError::Forward(rootcause::Report::new(error).into_dynamic())
                })?;
            if must_wait {
                tracing::info!(%harness, %session, "parking a command until the computer wakes");
                self.parked.park(*harness, session, command);
                let inner = Arc::clone(&self.inner);
                let parked = Arc::clone(&self.parked);
                let harness = *harness;
                let shutdown = self.shutdown.clone();
                let span = tracing::info_span!("computer.prompt_wait", %harness, %session);
                self.tracker.spawn(
                    async move {
                        shutdown
                            .run_until_cancelled(async {
                                tokio::time::sleep(PARK_LIMIT).await;
                                flush(&*inner, &parked, harness).await;
                            })
                            .await;
                    }
                    .instrument(span),
                );
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
