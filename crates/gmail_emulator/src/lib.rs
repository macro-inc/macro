//! A stateful fake of the Google APIs Macro's email, calendar and sign-in
//! code call.
//!
//! [`GmailEmulator::start`] listens on a `127.0.0.1` port and serves, for any
//! number of mailboxes:
//!
//! - the Gmail REST API under [`GmailEmulator::gmail_url`]: profile,
//!   messages, threads, labels, drafts, send, attachments, filters, send-as,
//!   history (a `startHistoryId` older than Gmail keeps answers 404) and watch;
//! - the Google Calendar REST API under [`GmailEmulator::calendar_url`]:
//!   the calendar list, events with their recurrences, exceptions, guests
//!   and sync tokens (an expired one answers 410), and push channels;
//! - the People API under [`GmailEmulator::people_url`];
//! - "Sign in with Google": a page at
//!   [`GmailEmulator::authorization_url`] where a person picks one of the
//!   mailboxes' owners, the authorization code exchange with a signed ID
//!   token, and userinfo;
//! - Google's OAuth token, token-info and revoke endpoints, and the
//!   certificates that verify push and ID tokens
//!   ([`GmailEmulator::certs_url`]);
//! - a control API under `/_emulator/`, mirrored by the methods of
//!   [`GmailEmulator`]: seed mailboxes and calendars, deliver mail, change
//!   events, inject errors and rate limits, advance the clock, and read what
//!   was received and pushed.
//!
//! What a client writes it reads back, and every change lands in the
//! mailbox's history. After `users.watch`, a change posts a Pub/Sub-style
//! notification to the configured webhook, signed so that
//! `gmail_client`'s real JWT verification passes against the emulator's
//! certificates.
//!
//! The real `gmail_client::GmailClient` talks to it through
//! `GmailClient::new_with_urls`, and a running service through the
//! `OVERRIDE_GMAIL_API_URL`, `OVERRIDE_GOOGLE_PEOPLE_API_URL`,
//! `OVERRIDE_GOOGLE_CALENDAR_API_URL`, `OVERRIDE_GOOGLE_OAUTH_CERTS_URL` and
//! (in `email_service`) `OVERRIDE_GOOGLE_OAUTH_TOKEN_INFO_URL` service URL
//! overrides. Nothing here talks to Google.

#![deny(missing_docs)]

mod calendar;
mod calendar_routes;
mod control;
mod error;
mod fault;
mod gate;
mod gmail_routes;
mod google_routes;
mod mailbox;
mod mime;
mod people;
mod push;
mod query;
mod seed;
mod sign_in;
mod state;
#[cfg(test)]
mod test;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::{OnceCell, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

pub use calendar::{AccessRole, CalendarSummary, ChannelSummary, ResourceState};
pub use control::{AttendeeResponse, MessageSummary};
pub use fault::{Fault, FaultError, Route};
pub use seed::{
    DEFAULT_PUSH_AUDIENCE, NewAttachment, NewEvent, NewMessage, PushConfig, Seed, SeedCalendar,
    SeedContact, SeedError, SeedLabel, SeedMailbox, SeedReminder, SeedSendAs,
};

use crate::error::ApiError;
use crate::push::{SigningKey, SigningKeyError};
use crate::state::{PushJob, State};

/// Why a control operation was refused.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EmulatorError {
    /// No mailbox has this address.
    #[error("no mailbox `{0}`")]
    UnknownMailbox(String),
    /// A mailbox with this address already exists.
    #[error("mailbox `{0}` already exists")]
    MailboxExists(String),
    /// The message could not be built or parsed.
    #[error("invalid message: {0}")]
    InvalidMessage(String),
    /// Gmail would refuse the operation with this status.
    #[error("refused with {status}: {message}")]
    Rejected {
        /// The HTTP status Gmail answers.
        status: u16,
        /// Gmail's error message.
        message: String,
    },
}

impl From<ApiError> for EmulatorError {
    fn from(error: ApiError) -> Self {
        Self::Rejected {
            status: error.status,
            message: error.message,
        }
    }
}

/// Why the emulator could not start.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    /// The listening address could not be bound.
    #[error("could not listen: {0}")]
    Bind(#[from] std::io::Error),
    /// The seed could not be applied.
    #[error(transparent)]
    Seed(#[from] SeedError),
}

/// A message the emulator put in a mailbox.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct Delivered {
    /// The Gmail message id.
    pub id: String,
    /// The Gmail thread id.
    pub thread_id: String,
    /// The mailbox's history id after the delivery.
    pub history_id: u64,
}

/// One request the emulator received on a Google API route.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct RequestRecord {
    /// When it arrived, by the emulator's clock.
    pub at: DateTime<Utc>,
    /// The HTTP method.
    pub method: String,
    /// The path and query.
    pub path: String,
    /// The API method it matched, when it matched one.
    pub route: Option<Route>,
    /// The mailbox its token belongs to, when it carried a valid one.
    pub mailbox: Option<String>,
    /// The status answered.
    pub status: u16,
}

/// One push notification the emulator sent, or failed to send.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct PushDelivery {
    /// When delivery finished, by the emulator's clock.
    pub at: DateTime<Utc>,
    /// The mailbox that changed.
    pub mailbox: String,
    /// The history id the notification carries.
    pub history_id: u64,
    /// The webhook it was posted to.
    pub endpoint: String,
    /// The webhook's last status, when it answered.
    pub status: Option<u16>,
    /// The transport error of the last attempt, when it did not answer.
    pub error: Option<String>,
    /// How many times it was posted.
    pub attempts: u8,
}

/// One Calendar push notification the emulator sent, or failed to send.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ChannelDelivery {
    /// When delivery finished, by the emulator's clock.
    pub at: DateTime<Utc>,
    /// The user whose calendar is watched.
    pub mailbox: String,
    /// The watched calendar.
    pub calendar_id: String,
    /// The channel, `X-Goog-Channel-ID`.
    pub channel_id: String,
    /// The watched resource, `X-Goog-Resource-ID`.
    pub resource_id: String,
    /// `sync` for a new channel, `exists` for a change.
    pub resource_state: ResourceState,
    /// The notification's number on its channel, from 1.
    pub message_number: u64,
    /// The webhook it was posted to.
    pub address: String,
    /// The webhook's last status, when it answered.
    pub status: Option<u16>,
    /// The transport error of the last attempt, when it did not answer.
    pub error: Option<String>,
    /// How many times it was posted.
    pub attempts: u8,
}

/// A mailbox at a glance.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct MailboxSummary {
    /// The mailbox address.
    pub email: String,
    /// The current history id.
    pub history_id: u64,
    /// How many messages it holds.
    pub messages: usize,
    /// How many threads it holds.
    pub threads: usize,
    /// When its watch expires, if it has one.
    pub watch_expires_at: Option<DateTime<Utc>>,
    /// Whether its OAuth grant is revoked.
    pub revoked: bool,
}

struct Inner {
    state: Mutex<State>,
    address: SocketAddr,
    /// Bumped on every state change, to wake waiters.
    changed: watch::Sender<u64>,
    push_jobs: mpsc::UnboundedSender<PushJob>,
    cancel: CancellationToken,
    tracker: TaskTracker,
    /// Made when first needed: generating it takes a few seconds in a
    /// debug build, and most tests never push.
    signing_key: OnceCell<SigningKey>,
}

/// A running emulator. Cloning it gives another handle to the same one.
#[derive(Clone)]
pub struct GmailEmulator {
    inner: Arc<Inner>,
}

impl GmailEmulator {
    /// Starts an emulator on a free `127.0.0.1` port.
    pub async fn start(seed: Seed) -> Result<Self, StartError> {
        Self::start_on(SocketAddr::from(([127, 0, 0, 1], 0)), seed).await
    }

    /// Starts an emulator on a given address.
    pub async fn start_on(address: SocketAddr, seed: Seed) -> Result<Self, StartError> {
        let listener = TcpListener::bind(address).await?;
        let address = listener.local_addr()?;
        let mut state = State::default();
        state.apply_seed(&seed)?;

        let (push_jobs, jobs) = mpsc::unbounded_channel();
        let emulator = Self {
            inner: Arc::new(Inner {
                state: Mutex::new(state),
                address,
                changed: watch::Sender::new(0),
                push_jobs,
                cancel: CancellationToken::new(),
                tracker: TaskTracker::new(),
                signing_key: OnceCell::new(),
            }),
        };

        let app = control::router()
            .merge(gmail_routes::router())
            .merge(calendar_routes::router())
            .merge(google_routes::router())
            .merge(sign_in::router())
            .layer(axum::middleware::from_fn_with_state(
                emulator.clone(),
                gate::log_request,
            ))
            .with_state(emulator.clone());
        let cancel = emulator.inner.cancel.clone();
        emulator.inner.tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { cancel.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "gmail emulator server stopped");
            }
        });
        emulator
            .inner
            .tracker
            .spawn(push::deliver_jobs(emulator.clone(), jobs));

        Ok(emulator)
    }

    /// Stops the server and the push worker, and waits for them.
    pub async fn shutdown(self) {
        self.inner.cancel.cancel();
        self.inner.tracker.close();
        self.inner.tracker.wait().await;
    }

    // -- addresses --

    /// The emulator's origin, `http://127.0.0.1:<port>`.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.inner.address)
    }

    /// The Gmail REST base, in place of `https://www.googleapis.com/gmail/v1`.
    pub fn gmail_url(&self) -> String {
        format!("{}/gmail/v1", self.base_url())
    }

    /// The People API base, in place of `https://people.googleapis.com/v1`.
    pub fn people_url(&self) -> String {
        format!("{}/people/v1", self.base_url())
    }

    /// The Calendar REST base, in place of
    /// `https://www.googleapis.com/calendar/v3`.
    pub fn calendar_url(&self) -> String {
        format!("{}{}", self.base_url(), calendar_routes::BASE_PATH)
    }

    /// The certificates that verify push tokens, in place of
    /// `https://www.googleapis.com/oauth2/v3/certs`.
    pub fn certs_url(&self) -> String {
        format!("{}/oauth2/v3/certs", self.base_url())
    }

    /// The OAuth token endpoint, in place of
    /// `https://oauth2.googleapis.com/token`.
    pub fn token_url(&self) -> String {
        format!("{}/token", self.base_url())
    }

    /// The page where a person signs in as a seeded user, in place of
    /// `https://accounts.google.com/o/oauth2/v2/auth`.
    pub fn authorization_url(&self) -> String {
        format!("{}{}", self.base_url(), sign_in::AUTHORIZATION_PATH)
    }

    /// The OpenID Connect userinfo endpoint, in place of
    /// `https://openidconnect.googleapis.com/v1/userinfo`.
    pub fn userinfo_url(&self) -> String {
        format!("{}{}", self.base_url(), sign_in::USERINFO_PATH)
    }

    /// The OAuth revocation endpoint, in place of
    /// `https://oauth2.googleapis.com/revoke`.
    pub fn revoke_url(&self) -> String {
        format!("{}/revoke", self.base_url())
    }

    /// A stand-in for the authentication service's Google access-token
    /// route, for running `email_service` without that service.
    pub fn authentication_service_url(&self) -> String {
        format!("{}/_emulator/authentication-service", self.base_url())
    }

    /// The key that signs push and ID tokens, generated on first use.
    pub(crate) async fn signing_key(&self) -> Result<&SigningKey, SigningKeyError> {
        self.inner
            .signing_key
            .get_or_try_init(|| async { tokio::task::spawn_blocking(SigningKey::generate).await? })
            .await
    }

    // -- state --

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs a change, then queues the push notifications it caused and wakes
    /// anything waiting on the emulator's state.
    pub(crate) fn with_state<T>(&self, change: impl FnOnce(&mut State) -> T) -> T {
        let (result, jobs) = {
            let mut state = self.lock();
            let result = change(&mut state);
            (result, state.take_notifications())
        };

        for job in jobs {
            // The worker only stops at shutdown, when nothing is owed.
            self.inner.push_jobs.send(job).ok();
        }
        self.inner.changed.send_modify(|version| *version += 1);
        result
    }

    /// The emulator's current time.
    pub fn now(&self) -> DateTime<Utc> {
        self.lock().now()
    }

    /// Moves the emulator's clock forward. Access tokens and watches expire
    /// by it, and history older than a week is forgotten.
    pub fn advance_clock(&self, by: Duration) {
        let milliseconds = i64::try_from(by.as_millis()).unwrap_or(i64::MAX);
        self.with_state(|state| state.advance_clock(milliseconds));
    }

    /// Adds mailboxes, and sets the clock and push endpoint a seed names.
    pub fn seed(&self, seed: &Seed) -> Result<(), SeedError> {
        self.with_state(|state| state.apply_seed(seed))
    }

    /// Forgets everything, then applies a seed.
    pub fn reset(&self, seed: &Seed) -> Result<(), SeedError> {
        self.with_state(|state| {
            *state = State::default();
            state.apply_seed(seed)
        })
    }

    /// Adds a mailbox.
    pub fn add_mailbox(&self, mailbox: &SeedMailbox) -> Result<(), EmulatorError> {
        self.with_state(|state| state.add_mailbox(mailbox))
    }

    /// Every mailbox at a glance.
    pub fn mailboxes(&self) -> Vec<MailboxSummary> {
        self.lock()
            .mailboxes
            .values()
            .map(|mailbox| MailboxSummary {
                email: mailbox.email.clone(),
                history_id: mailbox.history_id,
                messages: mailbox.messages.len(),
                threads: mailbox.thread_count(),
                watch_expires_at: mailbox
                    .watch
                    .as_ref()
                    .and_then(|watch| DateTime::from_timestamp_millis(watch.expires_at_ms)),
                revoked: mailbox.revoked,
            })
            .collect()
    }

    /// Mints an access token for a mailbox, valid for an hour of the
    /// emulator's clock.
    pub fn access_token(&self, email: &str) -> Result<String, EmulatorError> {
        self.with_state(|state| state.issue_access_token(email))
    }

    /// Revokes a mailbox's grant: its tokens answer 401 and its refresh
    /// token `invalid_grant`.
    pub fn revoke_grant(&self, email: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state.mailbox_mut(email)?.revoked = true;
            Ok(())
        })
    }

    /// Delivers new mail to a mailbox. Its filters run unless the message
    /// names its labels.
    pub fn deliver(&self, email: &str, message: &NewMessage) -> Result<Delivered, EmulatorError> {
        self.with_state(|state| state.deliver(email, message))
    }

    /// Changes a message's labels, as the mailbox's owner would in Gmail.
    pub fn modify_labels(
        &self,
        email: &str,
        message_id: &str,
        add: &[String],
        remove: &[String],
    ) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let now_ms = state.now_ms();
            Ok(state
                .mailbox_mut(email)?
                .modify(now_ms, message_id, add, remove)?)
        })
    }

    /// Deletes a message for good, as the mailbox's owner would in Gmail.
    pub fn delete_message(&self, email: &str, message_id: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let now_ms = state.now_ms();
            Ok(state.mailbox_mut(email)?.delete(now_ms, message_id)?)
        })
    }

    /// Forgets a mailbox's history, so every history id a client stored is
    /// too old and `history.list` answers 404.
    pub fn expire_history(&self, email: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state.mailbox_mut(email)?.expire_history();
            Ok(())
        })
    }

    /// Sets the HTML signature of a mailbox's primary address, as its owner
    /// does in Gmail's settings. `settings.sendAs.list` answers it.
    pub fn set_signature(&self, email: &str, signature: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state.mailbox_mut(email)?.signature = signature.to_string();
            Ok(())
        })
    }

    /// Replaces a mailbox's send-as aliases, as its owner does in Gmail's
    /// settings (adding, removing or verifying one). `settings.sendAs.list`
    /// answers the new set after the primary address.
    pub fn set_send_as(&self, email: &str, aliases: Vec<SeedSendAs>) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            state.mailbox_mut(email)?.send_as = aliases;
            Ok(())
        })
    }

    /// Adds or changes a contact of a mailbox.
    pub fn upsert_contact(
        &self,
        email: &str,
        contact: SeedContact,
        other: bool,
    ) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let mailbox = state.mailbox_mut(email)?;
            match other {
                true => mailbox.other_contacts.upsert(contact),
                false => mailbox.contacts.upsert(contact),
            }
            Ok(())
        })
    }

    /// Deletes a contact of a mailbox. Returns whether there was one.
    pub fn remove_contact(
        &self,
        email: &str,
        contact_email: &str,
        other: bool,
    ) -> Result<bool, EmulatorError> {
        self.with_state(|state| {
            let mailbox = state.mailbox_mut(email)?;
            Ok(match other {
                true => mailbox.other_contacts.remove(contact_email),
                false => mailbox.contacts.remove(contact_email),
            })
        })
    }

    /// Expires every contacts sync token a mailbox handed out.
    pub fn expire_contact_sync_tokens(&self, email: &str) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let mailbox = state.mailbox_mut(email)?;
            mailbox.contacts.expire_sync_tokens();
            mailbox.other_contacts.expire_sync_tokens();
            Ok(())
        })
    }

    // -- faults --

    /// Injects a failure. Returns its id.
    pub fn inject_fault(&self, fault: Fault) -> u64 {
        self.with_state(|state| state.add_fault(fault))
    }

    /// The faults still in force, with their ids.
    pub fn faults(&self) -> Vec<(u64, Fault)> {
        self.lock().faults.clone()
    }

    /// Removes one fault. Returns whether it was still in force.
    pub fn remove_fault(&self, id: u64) -> bool {
        self.with_state(|state| {
            let before = state.faults.len();
            state.faults.retain(|(fault_id, _)| *fault_id != id);
            state.faults.len() != before
        })
    }

    /// Removes every fault.
    pub fn clear_faults(&self) {
        self.with_state(|state| state.faults.clear());
    }

    // -- what the emulator saw and sent --

    /// Every Google API request received so far.
    pub fn requests(&self) -> Vec<RequestRecord> {
        self.lock().requests.clone()
    }

    /// Forgets the requests received so far.
    pub fn clear_requests(&self) {
        self.with_state(|state| state.requests.clear());
    }

    /// The push endpoint in force.
    pub fn push_config(&self) -> Option<PushConfig> {
        self.lock().push.clone()
    }

    /// Sets, or with `None` removes, the push endpoint.
    pub fn set_push(&self, push: Option<PushConfig>) {
        self.with_state(|state| state.push = push);
    }

    /// Sends a mailbox's watch a notification for its current history id,
    /// whether or not anything changed.
    pub fn push_now(&self, email: &str) -> Result<(), EmulatorError> {
        let job = {
            let mut state = self.lock();
            let mailbox = state.mailbox_mut(email)?;
            let watch = mailbox.watch.as_ref().ok_or(EmulatorError::Rejected {
                status: 400,
                message: "mailbox has no watch".to_string(),
            })?;
            PushJob::Mailbox {
                email: mailbox.email.clone(),
                history_id: mailbox.history_id,
                topic: watch.topic.clone(),
            }
        };
        self.inner.push_jobs.send(job).ok();
        Ok(())
    }

    /// Every push notification delivered, or given up on, so far.
    pub fn push_deliveries(&self) -> Vec<PushDelivery> {
        self.lock().deliveries.clone()
    }

    /// Waits until at least `count` push notifications have finished, and
    /// returns them all.
    pub async fn wait_for_push_deliveries(&self, count: usize) -> Vec<PushDelivery> {
        let mut changed = self.inner.changed.subscribe();
        loop {
            let deliveries = self.push_deliveries();
            if deliveries.len() >= count {
                return deliveries;
            }
            if changed.changed().await.is_err() {
                return deliveries;
            }
        }
    }
}
