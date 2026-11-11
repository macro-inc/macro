//! Everything the emulator holds: mailboxes, tokens, the clock, injected
//! faults and the logs of what it received and pushed.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{DateTime, Utc};

use crate::error::ApiError;
use crate::fault::{Fault, FaultError, Route};
use crate::mailbox::{Ids, Mailbox};
use crate::mime;
use crate::seed::{NewMessage, PushConfig, Seed, SeedError, SeedMailbox};
use crate::{Delivered, EmulatorError, PushDelivery, RequestRecord};

/// Google access tokens last an hour.
pub(crate) const ACCESS_TOKEN_LIFETIME_SECONDS: i64 = 3599;
const INBOX: &str = "INBOX";
const UNREAD: &str = "UNREAD";
const SENT: &str = "SENT";

#[derive(Debug)]
struct AccessToken {
    email: String,
    expires_at_ms: i64,
}

/// A push notification waiting to be delivered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PushJob {
    pub(crate) email: String,
    pub(crate) history_id: u64,
    pub(crate) topic: String,
}

#[derive(Debug, Default)]
pub(crate) struct State {
    pub(crate) mailboxes: BTreeMap<String, Mailbox>,
    pub(crate) ids: Ids,
    /// The emulator's time minus the real time.
    clock_offset_ms: i64,
    tokens: HashMap<String, AccessToken>,
    next_token: u64,
    pub(crate) faults: Vec<(u64, Fault)>,
    next_fault: u64,
    pub(crate) requests: Vec<RequestRecord>,
    pub(crate) push: Option<PushConfig>,
    pub(crate) deliveries: Vec<PushDelivery>,
}

impl State {
    pub(crate) fn now_ms(&self) -> i64 {
        Utc::now().timestamp_millis() + self.clock_offset_ms
    }

    pub(crate) fn now(&self) -> DateTime<Utc> {
        DateTime::from_timestamp_millis(self.now_ms()).unwrap_or_else(Utc::now)
    }

    pub(crate) fn advance_clock(&mut self, milliseconds: i64) {
        self.clock_offset_ms += milliseconds;
        let now_ms = self.now_ms();
        for mailbox in self.mailboxes.values_mut() {
            mailbox.prune_history(now_ms);
        }
    }

    pub(crate) fn apply_seed(&mut self, seed: &Seed) -> Result<(), SeedError> {
        if let Some(clock) = seed.clock {
            self.clock_offset_ms = clock.timestamp_millis() - Utc::now().timestamp_millis();
        }
        if let Some(push) = &seed.push {
            self.push = Some(push.clone());
        }

        for mailbox in &seed.mailboxes {
            self.add_mailbox(mailbox)
                .map_err(|source| SeedError::Mailbox {
                    mailbox: mailbox.email.clone(),
                    source,
                })?;
        }
        Ok(())
    }

    /// Adds a mailbox with its seeded messages. Seeded messages keep the
    /// labels they name; the mailbox's filters do not run on them.
    pub(crate) fn add_mailbox(&mut self, seed: &SeedMailbox) -> Result<(), EmulatorError> {
        let mailbox = Mailbox::new(seed);
        let email = mailbox.email.clone();
        if self.mailboxes.contains_key(&email) {
            return Err(EmulatorError::MailboxExists(email));
        }
        self.mailboxes.insert(email.clone(), mailbox);

        for message in &seed.messages {
            let seeded = NewMessage {
                labels: Some(
                    message
                        .labels
                        .clone()
                        .unwrap_or_else(|| vec![INBOX.to_string(), UNREAD.to_string()]),
                ),
                ..message.clone()
            };
            self.deliver(&email, &seeded)?;
        }
        Ok(())
    }

    pub(crate) fn mailbox_mut(&mut self, email: &str) -> Result<&mut Mailbox, EmulatorError> {
        self.mailboxes
            .get_mut(&email.to_lowercase())
            .ok_or_else(|| EmulatorError::UnknownMailbox(email.to_string()))
    }

    // -- tokens --

    /// Mints an access token for a mailbox, as a token refresh would.
    pub(crate) fn issue_access_token(&mut self, email: &str) -> Result<String, EmulatorError> {
        let expires_at_ms = self.now_ms() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000;
        let email = self.mailbox_mut(email)?.email.clone();
        self.next_token += 1;
        let token = format!("ya29.emulator-{}", self.next_token);
        self.tokens.insert(
            token.clone(),
            AccessToken {
                email,
                expires_at_ms,
            },
        );
        Ok(token)
    }

    /// The mailbox holding a refresh token, unless its grant is revoked.
    pub(crate) fn mailbox_for_refresh_token(&self, refresh_token: &str) -> Option<&Mailbox> {
        self.mailboxes
            .values()
            .find(|mailbox| mailbox.refresh_token == refresh_token && !mailbox.revoked)
    }

    /// The mailbox a live access token belongs to, and when the token expires.
    pub(crate) fn token_owner(&self, token: &str) -> Option<(&Mailbox, i64)> {
        let access = self.tokens.get(token)?;
        let mailbox = self.mailboxes.get(&access.email)?;
        if mailbox.revoked || access.expires_at_ms <= self.now_ms() {
            return None;
        }
        Some((mailbox, access.expires_at_ms))
    }

    /// Revokes the grant a refresh or access token belongs to.
    pub(crate) fn revoke_token(&mut self, token: &str) -> bool {
        let email = match self.tokens.get(token) {
            Some(access) => Some(access.email.clone()),
            None => self
                .mailbox_for_refresh_token(token)
                .map(|mailbox| mailbox.email.clone()),
        };
        match email.and_then(|email| self.mailboxes.get_mut(&email)) {
            Some(mailbox) => {
                mailbox.revoked = true;
                true
            }
            None => false,
        }
    }

    // -- faults --

    pub(crate) fn add_fault(&mut self, fault: Fault) -> u64 {
        self.next_fault += 1;
        self.faults.push((self.next_fault, fault));
        self.next_fault
    }

    /// The first fault matching a request, counted against its `times`.
    pub(crate) fn take_fault(&mut self, email: Option<&str>, route: Route) -> Option<Fault> {
        let index = self.faults.iter().position(|(_, fault)| {
            let mailbox_matches = fault
                .mailbox
                .as_deref()
                .is_none_or(|wanted| email.is_some_and(|email| wanted.eq_ignore_ascii_case(email)));
            let route_matches = fault.route.is_none_or(|wanted| wanted == route);
            mailbox_matches && route_matches
        })?;

        let fault = self.faults[index].1.clone();
        if let Some(times) = &mut self.faults[index].1.times {
            *times = times.saturating_sub(1);
            if *times == 0 {
                self.faults.remove(index);
            }
        }
        Some(fault)
    }

    // -- mail --

    /// Puts a message in a mailbox, as arriving mail or as the owner's own
    /// action in Gmail. Filters run unless the message names its labels.
    pub(crate) fn deliver(
        &mut self,
        email: &str,
        message: &NewMessage,
    ) -> Result<Delivered, EmulatorError> {
        let now_ms = self.now_ms();
        let default_message_id = format!("{}@mail.emulator.test", self.ids.next());
        let mailbox = self
            .mailboxes
            .get_mut(&email.to_lowercase())
            .ok_or_else(|| EmulatorError::UnknownMailbox(email.to_string()))?;
        let raw = mime::build_raw(message, &mailbox.email, &default_message_id, now_ms)?;

        let labels: Vec<String> = match &message.labels {
            Some(labels) => labels.clone(),
            None => {
                let mut labels = BTreeSet::from([INBOX.to_string(), UNREAD.to_string()]);
                mailbox.filtered_labels(&raw, &mut labels);
                labels.into_iter().collect()
            }
        };
        let (id, thread_id) = mailbox.insert(
            &mut self.ids,
            now_ms,
            raw,
            &labels,
            message.thread_id.as_deref(),
            message.date.map(|date| date.timestamp_millis()),
        )?;

        Ok(Delivered {
            id,
            thread_id,
            history_id: mailbox.history_id,
        })
    }

    /// `users.messages.send`: stores the message as sent, and delivers a
    /// copy to every recipient that is a mailbox of this emulator.
    pub(crate) fn send(
        &mut self,
        email: &str,
        raw: Vec<u8>,
        thread_id: Option<&str>,
    ) -> Result<(String, String), ApiError> {
        let now_ms = self.now_ms();
        let raw = self.with_required_headers(raw, now_ms);
        let parsed =
            mime::parse(&raw).map_err(|error| ApiError::invalid_argument(&error.to_string()))?;
        let recipients = parsed.recipients();
        if recipients.is_empty() {
            return Err(ApiError::invalid_argument("Recipient address required"));
        }

        let mut labels = vec![SENT.to_string()];
        if recipients.iter().any(|recipient| recipient == email) {
            labels.extend([INBOX.to_string(), UNREAD.to_string()]);
        }
        let sender = self
            .mailboxes
            .get_mut(email)
            .ok_or_else(ApiError::not_found)?;
        let sent = sender.insert(&mut self.ids, now_ms, raw.clone(), &labels, thread_id, None)?;

        let delivered_raw = mime::without_header(&raw, "Bcc");
        let others: BTreeSet<&String> = recipients
            .iter()
            .filter(|recipient| recipient.as_str() != email)
            .collect();
        for recipient in others {
            let Some(mailbox) = self.mailboxes.get_mut(recipient) else {
                continue;
            };
            let mut labels = BTreeSet::from([INBOX.to_string(), UNREAD.to_string()]);
            mailbox.filtered_labels(&delivered_raw, &mut labels);
            let labels: Vec<String> = labels.into_iter().collect();
            mailbox.insert(
                &mut self.ids,
                now_ms,
                delivered_raw.clone(),
                &labels,
                None,
                None,
            )?;
        }

        Ok(sent)
    }

    /// Gmail adds the `Message-ID` and `Date` a sent message lacks.
    fn with_required_headers(&mut self, raw: Vec<u8>, now_ms: i64) -> Vec<u8> {
        let Ok(parsed) = mime::parse(&raw) else {
            return raw;
        };

        let mut added = String::new();
        if parsed.message_id.is_none() {
            added.push_str(&format!(
                "Message-ID: <{}@mail.emulator.test>\r\n",
                self.ids.next()
            ));
        }
        if parsed.header("Date").is_none() {
            let date = DateTime::from_timestamp_millis(now_ms).unwrap_or_else(Utc::now);
            added.push_str(&format!("Date: {}\r\n", date.to_rfc2822()));
        }

        [added.into_bytes(), raw].concat()
    }

    // -- push --

    /// The notifications owed to watches whose mailbox changed.
    pub(crate) fn take_notifications(&mut self) -> Vec<PushJob> {
        let now_ms = self.now_ms();
        self.mailboxes
            .values_mut()
            .filter_map(|mailbox| {
                let history_id = mailbox.take_notification(now_ms)?;
                Some(PushJob {
                    email: mailbox.email.clone(),
                    history_id,
                    topic: mailbox.watch.as_ref()?.topic.clone(),
                })
            })
            .collect()
    }

    /// Answers an injected error, when a fault matches.
    pub(crate) fn fault_error(fault: &Fault) -> Option<ApiError> {
        let retry_after = fault.retry_after_seconds;
        Some(match fault.error? {
            FaultError::RateLimit => {
                ApiError::rate_limited("User-rate limit exceeded.  Retry later.", retry_after)
            }
            FaultError::ConcurrentRequests => {
                ApiError::rate_limited("Too many concurrent requests for user.", retry_after)
            }
            FaultError::QuotaExceeded => ApiError {
                retry_after_seconds: retry_after,
                ..ApiError::quota_exceeded("userRateLimitExceeded", "User Rate Limit Exceeded")
            },
            FaultError::DailyLimit => {
                ApiError::quota_exceeded("dailyLimitExceeded", "Daily Limit Exceeded")
            }
            FaultError::Internal => {
                ApiError::backend(500, "INTERNAL", "Internal error encountered.")
            }
            FaultError::Unavailable => ApiError {
                retry_after_seconds: retry_after,
                ..ApiError::backend(503, "UNAVAILABLE", "The service is currently unavailable.")
            },
            FaultError::Unauthorized => ApiError::unauthenticated(),
            FaultError::Forbidden => {
                ApiError::permission_denied("Request had insufficient authentication scopes.")
            }
            FaultError::NotFound => ApiError::not_found(),
        })
    }
}
