//! Everything the emulator holds: mailboxes, tokens, the clock, injected
//! faults and the logs of what it received and pushed.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{DateTime, Utc};

use crate::calendar::{Calendar, ChannelNotification, WriteOptions};
use crate::error::ApiError;
use crate::fault::{Fault, FaultError, Route};
use crate::mailbox::{Ids, Mailbox};
use crate::mime;
use crate::seed::{NewMessage, PushConfig, Seed, SeedCalendar, SeedError, SeedMailbox};
use crate::{ChannelDelivery, Delivered, EmulatorError, PushDelivery, RequestRecord};

/// Google access tokens last an hour.
pub(crate) const ACCESS_TOKEN_LIFETIME_SECONDS: i64 = 3599;
const INBOX: &str = "INBOX";
const UNREAD: &str = "UNREAD";
const SENT: &str = "SENT";

/// Google authorization codes last ten minutes.
const AUTHORIZATION_CODE_LIFETIME_MS: i64 = 10 * 60 * 1000;

#[derive(Debug)]
struct AccessToken {
    email: String,
    expires_at_ms: i64,
}

/// What the sign-in page hands back to the client for one consent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Consent {
    pub(crate) client_id: String,
    pub(crate) redirect_uri: String,
    /// The scopes the user left checked, in Google's canonical names.
    pub(crate) scopes: Vec<String>,
    /// `include_granted_scopes=true`: the tokens also carry what the user
    /// granted this client before.
    pub(crate) include_granted_scopes: bool,
    /// `access_type=offline`: the exchange returns a refresh token.
    pub(crate) offline: bool,
    pub(crate) nonce: Option<String>,
}

#[derive(Debug)]
struct AuthorizationCode {
    email: String,
    consent: Consent,
    expires_at_ms: i64,
}

/// The tokens an authorization code is exchanged for.
#[derive(Debug)]
pub(crate) struct CodeExchange {
    pub(crate) email: String,
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) scopes: Vec<String>,
    pub(crate) nonce: Option<String>,
}

/// Why Google's token endpoint refuses an authorization code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CodeRefusal {
    /// Unknown, expired or already used.
    Invalid,
    /// Issued to another client.
    WrongClient,
    /// Issued for another redirect URI.
    RedirectMismatch,
}

/// A push notification waiting to be delivered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PushJob {
    /// A Gmail watch notification, posted to the push endpoint.
    Mailbox {
        email: String,
        history_id: u64,
        topic: String,
    },
    /// A Calendar notification, posted to its channel's address.
    Channel(ChannelNotification),
}

#[derive(Debug, Default)]
pub(crate) struct State {
    pub(crate) mailboxes: BTreeMap<String, Mailbox>,
    pub(crate) ids: Ids,
    /// The emulator's time minus the real time.
    clock_offset_ms: i64,
    tokens: HashMap<String, AccessToken>,
    next_token: u64,
    codes: HashMap<String, AuthorizationCode>,
    pub(crate) faults: Vec<(u64, Fault)>,
    next_fault: u64,
    pub(crate) requests: Vec<RequestRecord>,
    pub(crate) push: Option<PushConfig>,
    pub(crate) deliveries: Vec<PushDelivery>,
    /// Calendar notifications owed for something other than a change, such
    /// as the `sync` message of a new channel.
    pub(crate) channel_notifications: Vec<ChannelNotification>,
    pub(crate) channel_deliveries: Vec<ChannelDelivery>,
    calendars_added: u64,
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

        for calendar in &seed.calendars {
            self.add_calendar(&email, calendar)?;
        }
        self.invite_to_existing_meetings(&email);
        Ok(())
    }

    /// Adds a calendar to a user's list with its seeded events. An entry
    /// without an id describes the user's primary calendar, which every
    /// user has.
    pub(crate) fn add_calendar(
        &mut self,
        email: &str,
        seed: &SeedCalendar,
    ) -> Result<String, EmulatorError> {
        self.calendars_added += 1;
        let generated = format!("c_{:026x}@group.calendar.google.com", self.calendars_added);
        let mailbox = self.mailbox_mut(email)?;
        let email = mailbox.email.clone();
        let id = seed.id.clone().unwrap_or_else(|| match seed.secondary {
            true => generated,
            false => email.clone(),
        });

        let calendar = match mailbox.calendars.remove(&id) {
            Some(calendar) if calendar.events.is_empty() => calendar.described_by(seed),
            Some(calendar) => {
                mailbox.calendars.insert(id.clone(), calendar);
                return Err(EmulatorError::Rejected {
                    status: 409,
                    message: format!("calendar `{id}` already exists"),
                });
            }
            None => Calendar::secondary(id.clone(), seed),
        };
        mailbox.calendars.insert(id.clone(), calendar);

        for event in &seed.events {
            self.insert_event(&email, &id, event.0.clone(), WriteOptions::publisher())?;
        }
        Ok(id)
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

    /// Records a user's consent on the sign-in page and returns the
    /// authorization code for it. Scopes add to the grant the client
    /// already holds; consenting after a revocation starts a new grant with
    /// a new refresh token, and the revoked grant's tokens stay dead.
    pub(crate) fn authorize(
        &mut self,
        email: &str,
        consent: Consent,
    ) -> Result<String, EmulatorError> {
        let expires_at_ms = self.now_ms() + AUTHORIZATION_CODE_LIFETIME_MS;
        self.next_token += 1;
        let serial = self.next_token;

        let mailbox = self.mailbox_mut(email)?;
        let email = mailbox.email.clone();
        let regranted = mailbox.revoked;
        if regranted {
            mailbox.revoked = false;
            mailbox.scopes.clear();
            mailbox.refresh_token = format!("1//emulator-{serial}");
        }
        for scope in &consent.scopes {
            if !mailbox.scopes.contains(scope) {
                mailbox.scopes.push(scope.clone());
            }
        }
        if regranted {
            self.tokens.retain(|_, token| token.email != email);
        }

        let code = format!("4/emulator-{serial}");
        self.codes.insert(
            code.clone(),
            AuthorizationCode {
                email,
                consent,
                expires_at_ms,
            },
        );
        Ok(code)
    }

    /// Exchanges an authorization code for tokens. A code works once.
    pub(crate) fn exchange_code(
        &mut self,
        code: &str,
        client_id: &str,
        redirect_uri: &str,
    ) -> Result<CodeExchange, CodeRefusal> {
        let issued = self.codes.remove(code).ok_or(CodeRefusal::Invalid)?;
        if issued.expires_at_ms <= self.now_ms() {
            return Err(CodeRefusal::Invalid);
        }
        if issued.consent.client_id != client_id {
            return Err(CodeRefusal::WrongClient);
        }
        if issued.consent.redirect_uri != redirect_uri {
            return Err(CodeRefusal::RedirectMismatch);
        }

        let access_token = self
            .issue_access_token(&issued.email)
            .map_err(|_| CodeRefusal::Invalid)?;
        let mailbox = self
            .mailboxes
            .get(&issued.email)
            .filter(|mailbox| !mailbox.revoked)
            .ok_or(CodeRefusal::Invalid)?;
        let scopes = match issued.consent.include_granted_scopes {
            true => mailbox.scopes.clone(),
            false => issued.consent.scopes,
        };

        Ok(CodeExchange {
            email: issued.email,
            access_token,
            refresh_token: issued
                .consent
                .offline
                .then(|| mailbox.refresh_token.clone()),
            scopes,
            nonce: issued.consent.nonce,
        })
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
        let mut jobs: Vec<PushJob> = self
            .mailboxes
            .values_mut()
            .filter_map(|mailbox| {
                let history_id = mailbox.take_notification(now_ms)?;
                Some(PushJob::Mailbox {
                    email: mailbox.email.clone(),
                    history_id,
                    topic: mailbox.watch.as_ref()?.topic.clone(),
                })
            })
            .collect();

        let opened = std::mem::take(&mut self.channel_notifications);
        let changed = self.mailboxes.values_mut().flat_map(|mailbox| {
            let email = mailbox.email.clone();
            mailbox
                .calendars
                .values_mut()
                .flat_map(move |calendar| calendar.take_notifications(&email, now_ms))
        });
        jobs.extend(opened.into_iter().chain(changed).map(PushJob::Channel));
        jobs
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
            FaultError::InsufficientPermissions => ApiError::calendar(
                403,
                "insufficientPermissions",
                "Request had insufficient authentication scopes.",
            ),
            FaultError::UsageLimits => ApiError {
                domain: "usageLimits",
                ..ApiError::calendar(403, "quotaExceeded", "Calendar usage limits exceeded.")
            },
            FaultError::Gone => ApiError::calendar(
                410,
                "fullSyncRequired",
                "Sync token is no longer valid, a full sync is required.",
            ),
            FaultError::PreconditionFailed => {
                ApiError::calendar(412, "conditionNotMet", "Precondition check failed.")
            }
        })
    }
}
