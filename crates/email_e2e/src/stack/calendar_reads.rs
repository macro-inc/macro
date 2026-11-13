//! The calendar read routes, served in-process on the scenario's database.
//!
//! In production `document_storage_service` hosts them. That service needs
//! far more than a calendar scenario does (search, object storage, calls), so
//! the harness mounts the same routers from `calendar_events` with the same
//! services and the Postgres adapters, composed as that service composes them.
//! What the join request service would tell the notification service and the
//! connection gateway is recorded instead ([`CalendarSignal`]).

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use axum::Router;
use calendar_events::domain::join_requests::{CalendarJoinRequest, CalendarJoinRequestServiceImpl};
use calendar_events::domain::ports::{CalendarJoinRequestNotifier, CalendarRefreshNotifier};
use calendar_events::domain::service::CalendarService;
use calendar_events::domain::team::CalendarTeamServiceImpl;
use calendar_events::inbound::axum_router::{CalendarRouterState, calendar_router};
use calendar_events::inbound::join_request_router::{
    CalendarJoinRequestRouterState, calendar_join_request_router,
};
use calendar_events::inbound::team_router::{CalendarTeamRouterState, team_calendar_router};
use calendar_events::outbound::pg::PgCalendarRepository;
use calendar_events::outbound::pg_team::PgCalendarTeamRepository;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer,
};
use rootcause::prelude::*;
use sqlx::PgPool;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

/// Something the calendar read routes told another service: what
/// `document_storage_service` sends to the notification service and the
/// connection gateway when someone asks to join a shared event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarSignal {
    /// The sharer was notified of a new request to join their event.
    JoinRequestNotification {
        /// The Macro id of the user who shared the event.
        sharer_id: String,
        /// The request.
        request_id: Uuid,
        /// The sharer's copy of the event.
        event_id: Uuid,
        /// The Macro id of the user asking.
        requester_id: String,
        /// The event's title, as the notification shows it.
        event_title: String,
    },
    /// Open clients of an inbox were told its calendar changed.
    CalendarChanged {
        /// The Macro id of the inbox's owner.
        owner_id: String,
        /// The inbox.
        email_link_id: Uuid,
        /// Whether teammates' out-of-office overlays must refresh too.
        team_ooo_changed: bool,
    },
    /// A requester's open clients were told their request was answered.
    JoinRequestAnswered {
        /// The Macro id of the user who asked.
        requester_id: String,
        /// The event they asked to join.
        event_id: Uuid,
    },
}

/// Records every signal instead of sending it.
#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<CalendarSignal>>>);

impl Recorder {
    fn record(&self, signal: CalendarSignal) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(signal);
    }
}

impl CalendarJoinRequestNotifier for Recorder {
    async fn notify_join_request(
        &self,
        sharer_id: &str,
        request: &CalendarJoinRequest,
        event_title: &str,
    ) {
        self.record(CalendarSignal::JoinRequestNotification {
            sharer_id: sharer_id.to_owned(),
            request_id: request.id,
            event_id: request.event_id,
            requester_id: request.requester_id.clone(),
            event_title: event_title.to_owned(),
        });
    }
}

impl CalendarRefreshNotifier for Recorder {
    async fn calendar_changed(&self, owner_id: &str, email_link_id: Uuid, team_ooo_changed: bool) {
        self.record(CalendarSignal::CalendarChanged {
            owner_id: owner_id.to_owned(),
            email_link_id,
            team_ooo_changed,
        });
    }

    async fn join_request_answered(&self, requester_id: &str, event_id: Uuid) {
        self.record(CalendarSignal::JoinRequestAnswered {
            requester_id: requester_id.to_owned(),
            event_id,
        });
    }
}

/// The running read routes.
pub(crate) struct CalendarReads {
    address: SocketAddr,
    recorder: Recorder,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

impl CalendarReads {
    /// Serves the read routes on `db`, accepting the internal headers with
    /// `internal_api_key` as the services do.
    pub(crate) async fn start(
        db: PgPool,
        internal_api_key: &str,
        team_sharing: bool,
    ) -> Result<Self, Report> {
        let authorization =
            MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
                MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
                InternalAuthConfig {
                    api_key: internal_api_key.to_owned(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            )));
        let recorder = Recorder::default();

        let app: Router = Router::new()
            .merge(calendar_router(CalendarRouterState::new(
                Arc::new(
                    CalendarService::new(PgCalendarRepository::new(db.clone()))
                        .with_team_sharing_enabled(team_sharing),
                ),
                authorization.clone(),
            )))
            .merge(calendar_join_request_router(
                CalendarJoinRequestRouterState::new(
                    Arc::new(CalendarJoinRequestServiceImpl::new(
                        PgCalendarRepository::new(db.clone()),
                        recorder.clone(),
                        recorder.clone(),
                    )),
                    authorization.clone(),
                ),
            ))
            .merge(team_calendar_router(CalendarTeamRouterState::new(
                Arc::new(CalendarTeamServiceImpl::new(
                    PgCalendarTeamRepository::new(db),
                    team_sharing,
                )),
                authorization,
            )));

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("could not bind the calendar read routes")?;
        let address = listener.local_addr()?;
        let cancel = CancellationToken::new();
        let tracker = TaskTracker::new();
        let stopped = cancel.clone();
        tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { stopped.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "the calendar read routes stopped");
            }
        });

        Ok(Self {
            address,
            recorder,
            cancel,
            tracker,
        })
    }

    /// The base URL of the read routes.
    pub(crate) fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    /// Every signal recorded so far, oldest first.
    pub(crate) fn signals(&self) -> Vec<CalendarSignal> {
        self.recorder
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Stops the server.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}
