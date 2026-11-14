//! A stateful fake of the Microsoft Graph mail and calendar APIs Macro's
//! email and calendar code call.
//!
//! [`OutlookEmulator::start`] listens on a `127.0.0.1` port and serves, for
//! any number of mailboxes:
//!
//! - Graph v1.0 under [`OutlookEmulator::graph_url`]: messages, mail folders,
//!   folder delta queries (skip and delta tokens, 410 for an expired one),
//!   drafts, replies and forwards, send, attachments and upload sessions,
//!   master categories, inbox rules, contacts, `$batch`, and subscriptions;
//!   mailbox settings, calendars, `calendarView` and its delta, events,
//!   series with their instances, exceptions and deleted occurrences, and
//!   creating, changing, deleting and answering events;
//! - the Microsoft identity platform under [`OutlookEmulator::login_url`]:
//!   a sign-in page that lists the mailboxes as users, authorization codes,
//!   the token endpoint, ID tokens with their signing keys and OpenID
//!   discovery document, userinfo, and the admin-consent page;
//! - a control API under `/_emulator/`, mirrored by the methods of
//!   [`OutlookEmulator`]: seed mailboxes and calendars, deliver mail, change
//!   events, inject errors and throttling, advance the clock, and read what
//!   was received and notified.
//!
//! What a client writes it reads back, and every change shows up in the
//! folder's next delta round. Creating a subscription validates its
//! notification URL the way Graph does; afterwards a change to the mailbox
//! posts a change notification to it.
//!
//! The real `email_api_client` Outlook adapter talks to it through
//! `OutlookApiClientRepository::for_graph_url`, and a running service
//! through the `OVERRIDE_MICROSOFT_GRAPH_URL` service URL override. Sign-in
//! and Outlook linking reach it through `OVERRIDE_MICROSOFT_LOGIN_URL` and
//! `OVERRIDE_MICROSOFT_LOGIN_PAGE_URL`. Nothing here talks to Microsoft.

#![deny(missing_docs)]

mod calendar;
mod control;
mod error;
mod fault;
mod graph;
mod mailbox;
mod mime;
mod notify;
mod oauth;
mod odata;
mod render;
mod seed;
mod sign_in;
mod signing_key;
mod state;
#[cfg(test)]
mod test;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::{OnceCell, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

pub use control::{CalendarSummary, MessageChange, MessageSummary, SubscriptionSummary};
pub use fault::{Fault, FaultError, Route};
pub use seed::{
    NewAttachment, NewEvent, NewMessage, Seed, SeedCalendar, SeedContact, SeedError, SeedFolder,
    SeedMailbox,
};

use crate::signing_key::{SigningKey, SigningKeyError};
use crate::state::{NotificationJob, State};

/// Why a control operation was refused.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EmulatorError {
    /// No mailbox has this address.
    #[error("no mailbox {0}")]
    UnknownMailbox(String),
    /// A mailbox with this address already exists.
    #[error("mailbox {0} already exists")]
    MailboxExists(String),
    /// The mailbox has no folder with this name or id.
    #[error("no folder {0}")]
    UnknownFolder(String),
    /// The mailbox has no message with this id.
    #[error("no message {0}")]
    UnknownMessage(String),
    /// No subscription has this id.
    #[error("no subscription {0}")]
    UnknownSubscription(String),
    /// The mailbox has no calendar with this name or id.
    #[error("no calendar {0}")]
    UnknownCalendar(String),
    /// The mailbox has no event with this id.
    #[error("no event {0}")]
    UnknownEvent(String),
    /// An event could not be built or changed from what was given.
    #[error("invalid event: {0}")]
    InvalidEvent(String),
    /// A message could not be built from what was given.
    #[error("invalid message: {0}")]
    InvalidMessage(String),
    /// The mailbox's grant is revoked, so it gets no access token.
    #[error("the grant of {0} is revoked")]
    GrantRevoked(String),
}

/// Why an emulator could not start.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    /// The address could not be listened on.
    #[error("could not listen: {0}")]
    Listen(#[from] std::io::Error),
    /// The seed could not be applied.
    #[error(transparent)]
    Seed(#[from] SeedError),
    /// The client that calls subscribers could not be built, for instance
    /// because a trusted certificate is not valid PEM.
    #[error("could not build the notification client: {0}")]
    Notifier(#[from] reqwest::Error),
}

/// How an emulator differs from Graph's defaults.
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// Accepts `http://` notification URLs. Graph requires HTTPS.
    pub allow_http_notification_urls: bool,
    /// PEM certificates to trust, besides the system's, when calling an
    /// HTTPS notification URL: a local webhook's self-signed certificate.
    pub trusted_certificates: Vec<Vec<u8>>,
    /// The origin links in responses are built on, when clients reach the
    /// emulator through another address than the one it listens on.
    pub public_url: Option<String>,
    /// The origin a browser reaches the emulator at, when that is another
    /// address than services reach it at. The sign-in page is advertised
    /// there.
    pub browser_url: Option<String>,
}

/// What [`OutlookEmulator::deliver`] stored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Delivered {
    /// The message's id.
    pub id: String,
    /// Its conversation.
    pub conversation_id: String,
    /// The folder it landed in, after the inbox rules.
    pub folder_id: String,
}

/// One request the emulator served.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RequestRecord {
    /// When, by the emulator's clock.
    pub at: DateTime<Utc>,
    /// The HTTP method.
    pub method: String,
    /// The path and query.
    pub path: String,
    /// The route it matched, if any.
    pub route: Option<Route>,
    /// The mailbox its access token belongs to, if any.
    pub mailbox: Option<String>,
    /// The status answered.
    pub status: u16,
}

/// One call to a subscriber: a validation, a change notification or a
/// lifecycle notification.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct NotificationDelivery {
    /// When it finished, by the emulator's clock.
    pub at: DateTime<Utc>,
    /// The subscription it is for.
    pub subscription_id: String,
    /// The URL posted to.
    pub url: String,
    /// `validation`, `change` or `lifecycle`.
    pub kind: String,
    /// The JSON body posted. Null for a validation.
    pub body: Value,
    /// The status the subscriber answered, when it answered.
    pub status: Option<u16>,
    /// Why no acceptable answer came.
    pub error: Option<String>,
    /// How many times it was posted.
    pub attempts: u32,
}

/// A lifecycle notification Graph sends about a subscription.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleEvent {
    /// The subscriber must reauthorize or renew the subscription.
    ReauthorizationRequired,
    /// Graph removed the subscription.
    SubscriptionRemoved,
    /// Graph dropped notifications; the subscriber should resync.
    Missed,
}

/// A mailbox, in brief.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MailboxSummary {
    /// The mailbox address.
    pub email: String,
    /// The Graph user id.
    pub user_id: String,
    /// How many messages it holds.
    pub messages: usize,
    /// Whether its OAuth grant is revoked.
    pub revoked: bool,
}

struct Inner {
    state: Mutex<State>,
    public_url: String,
    browser_url: String,
    /// Generated on first use: it takes seconds in a debug build, and most
    /// tests never sign anything.
    signing_key: OnceCell<SigningKey>,
    /// Bumped on every state change, to wake waiters.
    changed: watch::Sender<u64>,
    jobs: mpsc::UnboundedSender<NotificationJob>,
    http: reqwest::Client,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

/// A running emulator. Cloning it gives another handle to the same one.
#[derive(Clone)]
pub struct OutlookEmulator {
    inner: Arc<Inner>,
}

impl OutlookEmulator {
    /// Starts an emulator on a free `127.0.0.1` port. It accepts `http://`
    /// notification URLs, so a test's subscriber needs no certificate.
    pub async fn start(seed: Seed) -> Result<Self, StartError> {
        let options = Options {
            allow_http_notification_urls: true,
            ..Options::default()
        };
        Self::start_on(SocketAddr::from(([127, 0, 0, 1], 0)), seed, options).await
    }

    /// Starts an emulator on a given address.
    pub async fn start_on(
        address: SocketAddr,
        seed: Seed,
        options: Options,
    ) -> Result<Self, StartError> {
        let listener = TcpListener::bind(address).await?;
        let address = listener.local_addr()?;
        let mut state = State::new(options.allow_http_notification_urls);
        state.apply_seed(&seed)?;

        let mut http = reqwest::Client::builder().timeout(notify::SUBSCRIBER_TIMEOUT);
        for pem in &options.trusted_certificates {
            http = http.add_root_certificate(reqwest::Certificate::from_pem(pem)?);
        }

        let (jobs, queued) = mpsc::unbounded_channel();
        let origin = |url: String| url.trim_end_matches('/').to_string();
        let public_url = options
            .public_url
            .map(origin)
            .unwrap_or_else(|| format!("http://{address}"));
        let emulator = Self {
            inner: Arc::new(Inner {
                state: Mutex::new(state),
                browser_url: options
                    .browser_url
                    .map(origin)
                    .unwrap_or_else(|| public_url.clone()),
                public_url,
                signing_key: OnceCell::new(),
                changed: watch::Sender::new(0),
                jobs,
                http: http.build()?,
                cancel: CancellationToken::new(),
                tracker: TaskTracker::new(),
            }),
        };

        let app = control::router()
            .merge(graph::router())
            .merge(oauth::router())
            .merge(sign_in::router())
            .layer(axum::middleware::from_fn_with_state(
                emulator.clone(),
                graph::log_request,
            ))
            .with_state(emulator.clone());
        let cancel = emulator.inner.cancel.clone();
        emulator.inner.tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { cancel.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "outlook emulator server stopped");
            }
        });
        emulator
            .inner
            .tracker
            .spawn(notify::deliver_jobs(emulator.clone(), queued));

        Ok(emulator)
    }

    /// Stops the server and the notification task, and waits for them.
    pub async fn shutdown(self) {
        self.inner.cancel.cancel();
        self.inner.tracker.close();
        self.inner.tracker.wait().await;
    }

    // -- addresses --

    /// The emulator's origin, `http://127.0.0.1:<port>`.
    pub fn base_url(&self) -> String {
        self.inner.public_url.clone()
    }

    /// The Graph API root, for `OVERRIDE_MICROSOFT_GRAPH_URL`.
    pub fn graph_url(&self) -> String {
        format!("{}/{}", self.inner.public_url, graph::API_VERSION)
    }

    /// Microsoft's OAuth token endpoint, for the `common` tenant.
    pub fn token_url(&self) -> String {
        format!("{}/common/oauth2/v2.0/token", self.inner.public_url)
    }

    /// The Microsoft identity platform's root as a service reaches it, for
    /// `OVERRIDE_MICROSOFT_LOGIN_URL`: the token endpoint, the OpenID
    /// discovery document and the signing keys of every tenant are under it.
    pub fn login_url(&self) -> String {
        format!("{}/", self.inner.public_url)
    }

    /// The Microsoft identity platform's root as a browser reaches it, for
    /// `OVERRIDE_MICROSOFT_LOGIN_PAGE_URL`: the sign-in and admin-consent
    /// pages of every tenant are under it.
    pub fn login_page_url(&self) -> String {
        format!("{}/", self.inner.browser_url)
    }

    /// The origin a browser reaches the emulator at.
    pub(crate) fn browser_url(&self) -> String {
        self.inner.browser_url.clone()
    }

    /// The key ID tokens are signed with.
    pub(crate) async fn signing_key(&self) -> Result<&SigningKey, SigningKeyError> {
        self.inner
            .signing_key
            .get_or_try_init(|| async { tokio::task::spawn_blocking(SigningKey::generate).await? })
            .await
    }

    /// A stand-in for Macro's authentication service, for
    /// `OVERRIDE_AUTH_SERVICE_URL`: it answers the internal Microsoft access
    /// token route for the links bound with [`Self::link_mailbox`].
    pub fn authentication_service_url(&self) -> String {
        format!("{}/_emulator/authentication-service", self.inner.public_url)
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs a change, then queues the notifications it caused and wakes
    /// anything waiting on the emulator's state.
    pub(crate) fn with_state<T>(&self, change: impl FnOnce(&mut State) -> T) -> T {
        let (result, jobs) = {
            let mut state = self.lock();
            state.sweep();
            let result = change(&mut state);
            state.collect_notifications();
            (result, std::mem::take(&mut state.outbox))
        };
        for job in jobs {
            // The task only stops at shutdown, when nothing is owed.
            self.inner.jobs.send(job).ok();
        }
        self.inner.changed.send_modify(|version| *version += 1);
        result
    }

    // -- clock and seeding --

    /// The emulator's current time.
    pub fn now(&self) -> DateTime<Utc> {
        self.lock().now()
    }

    /// Moves the emulator's clock forward. Access tokens, subscriptions,
    /// upload sessions and the request limit's window all follow it.
    pub fn advance_clock(&self, by: Duration) {
        let by = chrono::Duration::from_std(by).unwrap_or(chrono::Duration::MAX);
        self.with_state(|state| state.advance_clock(by));
    }

    /// Adds the mailboxes of a seed, and sets the clock it names.
    pub fn seed(&self, seed: &Seed) -> Result<(), SeedError> {
        self.with_state(|state| state.apply_seed(seed))
    }

    /// Forgets everything, then applies a seed.
    pub fn reset(&self, seed: &Seed) -> Result<(), SeedError> {
        self.with_state(|state| {
            *state = State::new(state.allow_http_notification_urls);
            state.apply_seed(seed)
        })
    }

    /// Adds a mailbox.
    pub fn add_mailbox(&self, mailbox: &SeedMailbox) -> Result<(), EmulatorError> {
        self.with_state(|state| state.add_mailbox(mailbox))
    }

    /// Every mailbox, in brief.
    pub fn mailboxes(&self) -> Vec<MailboxSummary> {
        let state = self.lock();
        state
            .mailboxes
            .values()
            .map(|mailbox| MailboxSummary {
                email: mailbox.email.clone(),
                user_id: mailbox.user_id.clone(),
                messages: mailbox.messages.len(),
                revoked: mailbox.revoked,
            })
            .collect()
    }

    // -- grants --

    /// A new access token for a mailbox, valid for an hour of the
    /// emulator's clock.
    pub fn access_token(&self, email: &str) -> Result<String, EmulatorError> {
        self.with_state(|state| state.issue_access_token(email))
    }

    /// Revokes a mailbox's grant: its access tokens answer 401, refreshing
    /// answers `invalid_grant`, and Graph removes its subscriptions.
    pub fn revoke_grant(&self, email: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| state.revoke_grant(email))
    }

    /// Binds a Macro email link id to a mailbox, so the authentication
    /// service stand-in can answer token requests for that link.
    pub fn link_mailbox(&self, link_id: &str, email: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let email = state.mailbox(email)?.email.clone();
            state.bind_link(link_id.to_lowercase(), email);
            Ok(())
        })
    }

    /// Binds a Macro email link id to the mailbox of the OAuth attempt it
    /// was made from, with the grants the stand-in described for that
    /// attempt: once they are all released, the link gets no access token.
    pub fn link_attempt(&self, link_id: &str, attempt_id: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let attempt = attempt_id.to_lowercase();
            let email = state
                .links
                .get(&attempt)
                .cloned()
                .ok_or_else(|| EmulatorError::UnknownMailbox(attempt.clone()))?;
            let grants = state.link_grants.get(&attempt).cloned().unwrap_or_default();
            let link = link_id.to_lowercase();
            state.bind_link(link.clone(), email);
            if !grants.is_empty() {
                state.link_grants.entry(link).or_default().extend(grants);
            }
            Ok(())
        })
    }

    // -- mail --

    /// Delivers new mail to a mailbox, as if someone outside had sent it.
    pub fn deliver(&self, email: &str, message: &NewMessage) -> Result<Delivered, EmulatorError> {
        self.with_state(|state| state.deliver(email, message))
    }

    /// Deletes a message, as if its owner had in Outlook.
    pub fn delete_message(&self, email: &str, message_id: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state
                .mailbox(email)?
                .remove_message(message_id)
                .map_err(|_| EmulatorError::UnknownMessage(message_id.to_string()))
        })
    }

    /// Drops a mailbox's sync state: its delta tokens answer 410, as after
    /// Graph expires them.
    pub fn expire_delta_tokens(&self, email: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state.mailbox(email)?.expire_delta_tokens();
            Ok(())
        })
    }

    /// Adds a contact to the default contacts folder, or changes the one
    /// with this id. Answers its id.
    pub fn upsert_contact(
        &self,
        email: &str,
        id: Option<String>,
        contact: &SeedContact,
    ) -> Result<String, EmulatorError> {
        self.with_state(|state| {
            let mailbox = state.mailbox(email)?;
            Ok(mailbox.upsert_contact(id, contact.name.clone(), vec![contact.email.clone()]))
        })
    }

    /// Removes a contact. Answers whether there was one.
    pub fn remove_contact(&self, email: &str, id: &str) -> Result<bool, EmulatorError> {
        self.with_state(|state| Ok(state.mailbox(email)?.remove_contact(id)))
    }

    // -- faults --

    /// Injects a failure. Answers its id.
    pub fn inject_fault(&self, fault: Fault) -> u64 {
        self.with_state(|state| state.inject_fault(fault))
    }

    /// The faults in force, with their ids.
    pub fn faults(&self) -> Vec<(u64, Fault)> {
        self.lock().faults()
    }

    /// Removes a fault. Answers whether there was one.
    pub fn remove_fault(&self, id: u64) -> bool {
        self.with_state(|state| state.remove_fault(id))
    }

    /// Removes every fault.
    pub fn clear_faults(&self) {
        self.with_state(State::clear_faults);
    }

    // -- what the emulator received and sent --

    /// Every request served so far, outside the control API.
    pub fn requests(&self) -> Vec<RequestRecord> {
        self.lock().requests.clone()
    }

    /// Forgets the requests served so far.
    pub fn clear_requests(&self) {
        self.with_state(|state| state.requests.clear());
    }

    /// Sends a subscription's lifecycle URL a lifecycle notification.
    /// `SubscriptionRemoved` also removes the subscription.
    pub fn send_lifecycle(
        &self,
        subscription_id: &str,
        event: LifecycleEvent,
    ) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            if !state.subscriptions.contains_key(subscription_id) {
                return Err(EmulatorError::UnknownSubscription(
                    subscription_id.to_string(),
                ));
            }
            state.queue_lifecycle(subscription_id, event);
            if event == LifecycleEvent::SubscriptionRemoved {
                state.subscriptions.remove(subscription_id);
            }
            Ok(())
        })
    }

    /// Every call made to a subscriber so far: validations, change
    /// notifications and lifecycle notifications.
    pub fn notifications(&self) -> Vec<NotificationDelivery> {
        self.lock().notifications.clone()
    }

    /// Waits until at least `count` calls to subscribers have finished, and
    /// returns them all.
    pub async fn wait_for_notifications(&self, count: usize) -> Vec<NotificationDelivery> {
        let mut changed = self.inner.changed.subscribe();
        loop {
            let notifications = self.notifications();
            if notifications.len() >= count {
                return notifications;
            }
            if changed.changed().await.is_err() {
                return notifications;
            }
        }
    }
}
