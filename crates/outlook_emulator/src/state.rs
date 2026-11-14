//! Everything one emulator holds: mailboxes, access tokens, subscriptions,
//! upload sessions, faults, the clock and the logs.

use std::collections::{BTreeMap, HashMap, HashSet};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};

use crate::error::GraphError;
use crate::fault::{Fault, Route};
use crate::mailbox::{Change, ChangeKind, Mailbox};
use crate::render;
use crate::seed::{NewMessage, Seed, SeedError, SeedMailbox};
use crate::{Delivered, EmulatorError, LifecycleEvent, NotificationDelivery, RequestRecord};

const ACCESS_TOKEN_LIFETIME_SECONDS: i64 = 3600;

const AUTHORIZATION_CODE_LIFETIME_SECONDS: i64 = 600;

struct AccessToken {
    email: String,
    expires_at: DateTime<Utc>,
}

/// What a user agreed to on the sign-in page.
pub(crate) struct Consent {
    pub(crate) client_id: String,
    pub(crate) redirect_uri: String,
    /// The scopes asked for, in the order asked.
    pub(crate) scopes: Vec<String>,
    pub(crate) nonce: Option<String>,
    /// The PKCE challenge (S256) the code is bound to.
    pub(crate) code_challenge: Option<String>,
}

struct AuthorizationCode {
    email: String,
    consent: Consent,
    expires_at: DateTime<Utc>,
}

/// Why the token endpoint refuses an authorization code.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CodeError {
    /// Not a code this emulator issued, or one already redeemed.
    Unknown,
    Expired,
    /// Redeemed by another client than it was issued to.
    Client,
    RedirectUri,
    /// The PKCE verifier is missing or does not match the challenge.
    Verifier,
}

/// What redeeming an authorization code yields.
pub(crate) struct Redeemed {
    pub(crate) email: String,
    pub(crate) consent: Consent,
}

/// A Graph subscription to a mailbox's messages.
#[derive(Clone, Debug)]
pub(crate) struct Subscription {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) resource: String,
    pub(crate) change_type: String,
    pub(crate) notification_url: String,
    pub(crate) lifecycle_url: Option<String>,
    pub(crate) client_state: Option<String>,
    pub(crate) expires_at: DateTime<Utc>,
}

/// An attachment being uploaded in ranges.
pub(crate) struct Upload {
    pub(crate) email: String,
    pub(crate) message_id: String,
    pub(crate) name: String,
    pub(crate) content_type: String,
    pub(crate) content_id: Option<String>,
    pub(crate) inline: bool,
    pub(crate) size: usize,
    pub(crate) received: Vec<u8>,
    pub(crate) expires_at: DateTime<Utc>,
}

/// A notification waiting to be posted to a subscriber.
#[derive(Clone, Debug)]
pub(crate) struct NotificationJob {
    pub(crate) subscription_id: String,
    pub(crate) url: String,
    /// `change` or `lifecycle`.
    pub(crate) kind: &'static str,
    pub(crate) body: Value,
}

#[derive(Default)]
pub(crate) struct State {
    clock_offset: Duration,
    pub(crate) mailboxes: BTreeMap<String, Mailbox>,
    tokens: HashMap<String, AccessToken>,
    issued: u64,
    faults: Vec<(u64, Fault)>,
    next_fault: u64,
    pub(crate) requests: Vec<RequestRecord>,
    pub(crate) subscriptions: BTreeMap<String, Subscription>,
    pub(crate) uploads: HashMap<String, Upload>,
    pub(crate) notifications: Vec<NotificationDelivery>,
    /// Notifications made by the current operation, not yet handed to the
    /// delivery task.
    pub(crate) outbox: Vec<NotificationJob>,
    /// Whether subscriptions may name `http://` notification URLs.
    pub(crate) allow_http_notification_urls: bool,
    /// The mailbox of each Macro email link the authentication-service
    /// stand-in answers for.
    pub(crate) links: HashMap<String, String>,
    /// The mailbox of each grant the authentication-service stand-in
    /// described, by grant id: one per principal who signed in to it.
    pub(crate) grants: HashMap<uuid::Uuid, String>,
    /// The grants each link was described with. A link whose grants were
    /// all released gets no access token; one never described with a grant
    /// is answered for as long as its mailbox is not revoked.
    pub(crate) link_grants: HashMap<String, HashSet<uuid::Uuid>>,
    /// The access token last handed out for each link.
    link_tokens: HashMap<String, String>,
    /// Authorization codes not yet redeemed.
    codes: HashMap<String, AuthorizationCode>,
    /// The mailbox of each refresh token handed out by a refresh.
    rotated_refresh_tokens: HashMap<String, String>,
}

impl State {
    pub(crate) fn new(allow_http_notification_urls: bool) -> Self {
        Self {
            allow_http_notification_urls,
            ..Self::default()
        }
    }

    // -- clock --

    pub(crate) fn now(&self) -> DateTime<Utc> {
        Utc::now() + self.clock_offset
    }

    pub(crate) fn now_ms(&self) -> i64 {
        self.now().timestamp_millis()
    }

    pub(crate) fn advance_clock(&mut self, by: Duration) {
        self.clock_offset += by;
    }

    // -- seeding --

    pub(crate) fn apply_seed(&mut self, seed: &Seed) -> Result<(), SeedError> {
        if let Some(clock) = seed.clock {
            self.clock_offset = clock - Utc::now();
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

    pub(crate) fn add_mailbox(&mut self, seed: &SeedMailbox) -> Result<(), EmulatorError> {
        let email = seed.email.to_lowercase();
        if self.mailboxes.contains_key(&email) {
            return Err(EmulatorError::MailboxExists(email));
        }
        let mailbox = Mailbox::new(seed, self.now())?;
        if let Some(link_id) = &seed.link_id {
            self.links.insert(link_id.to_lowercase(), email.clone());
        }
        self.mailboxes.insert(email, mailbox);
        Ok(())
    }

    pub(crate) fn mailbox(&mut self, email: &str) -> Result<&mut Mailbox, EmulatorError> {
        self.mailboxes
            .get_mut(&email.to_lowercase())
            .ok_or_else(|| EmulatorError::UnknownMailbox(email.to_string()))
    }

    // -- tokens --

    /// A new access token for the mailbox, valid for an hour of the
    /// emulator's clock.
    pub(crate) fn issue_access_token(&mut self, email: &str) -> Result<String, EmulatorError> {
        let now = self.now();
        let mailbox = self.mailbox(email)?;
        if mailbox.revoked {
            return Err(EmulatorError::GrantRevoked(mailbox.email.clone()));
        }
        let email = mailbox.email.clone();
        self.issued += 1;
        let token = format!(
            "EwBemulator.{}",
            URL_SAFE_NO_PAD.encode(format!("{email}/{}", self.issued))
        );
        self.tokens.insert(
            token.clone(),
            AccessToken {
                email,
                expires_at: now + Duration::seconds(ACCESS_TOKEN_LIFETIME_SECONDS),
            },
        );
        Ok(token)
    }

    /// Binds a link to a mailbox. The grants a link was described with are
    /// for one mailbox, so they go when the link moves to another.
    pub(crate) fn bind_link(&mut self, link_id: String, email: String) {
        let moved = self
            .links
            .insert(link_id.clone(), email.clone())
            .is_some_and(|before| before != email);
        if moved {
            self.link_grants.remove(&link_id);
        }
    }

    /// The access token for a Macro email link, as the authentication
    /// service hands it out: the cached one while it has two minutes left,
    /// unless a fresh one is forced. Answers whether it was cached.
    pub(crate) fn link_access_token(
        &mut self,
        link_id: &str,
        force_refresh: bool,
    ) -> Result<(String, bool), EmulatorError> {
        let link_id = link_id.to_lowercase();
        let email = self
            .links
            .get(&link_id)
            .cloned()
            .ok_or_else(|| EmulatorError::UnknownMailbox(link_id.clone()))?;
        let released = self.link_grants.get(&link_id).is_some_and(|grants| {
            !grants.is_empty() && !grants.iter().any(|grant| self.grants.contains_key(grant))
        });
        if released {
            return Err(EmulatorError::GrantRevoked(email));
        }
        let fresh_until = self.now() + Duration::seconds(120);
        let cached = self.link_tokens.get(&link_id).filter(|token| {
            self.tokens
                .get(*token)
                .is_some_and(|access| access.email == email && access.expires_at > fresh_until)
        });
        if let (Some(token), false) = (cached, force_refresh) {
            let revoked = self
                .mailboxes
                .get(&email)
                .is_some_and(|mailbox| mailbox.revoked);
            if !revoked {
                return Ok((token.clone(), true));
            }
        }
        let token = self.issue_access_token(&email)?;
        self.link_tokens.insert(link_id, token.clone());
        Ok((token, false))
    }

    pub(crate) fn access_token_lifetime_seconds() -> i64 {
        ACCESS_TOKEN_LIFETIME_SECONDS
    }

    /// The mailbox a live access token belongs to.
    pub(crate) fn token_owner(&self, token: &str) -> Result<String, GraphError> {
        let unknown = || {
            GraphError::unauthenticated("IDX14100: JWT is not well formed, there are no dots (.).")
        };
        let access = self.tokens.get(token).ok_or_else(unknown)?;
        let mailbox = self.mailboxes.get(&access.email).ok_or_else(unknown)?;
        if access.expires_at <= self.now() {
            return Err(GraphError::unauthenticated(
                "Lifetime validation failed, the token is expired.",
            ));
        }
        if mailbox.revoked {
            return Err(GraphError::unauthenticated(
                "Continuous access evaluation resulted in challenge with result: \
                 InteractionRequired and code: TokenIssuedBeforeRevocationTimestamp",
            ));
        }
        Ok(access.email.clone())
    }

    /// The mailbox a refresh token belongs to.
    pub(crate) fn refresh_token_owner(&self, refresh_token: &str) -> Option<&Mailbox> {
        match self.rotated_refresh_tokens.get(refresh_token) {
            Some(email) => self.mailboxes.get(email),
            None => self
                .mailboxes
                .values()
                .find(|mailbox| mailbox.refresh_token == refresh_token),
        }
    }

    /// A further refresh token for the mailbox's grant. Like Microsoft's,
    /// it replaces none: the earlier ones keep working until the grant is
    /// revoked.
    pub(crate) fn rotate_refresh_token(&mut self, email: &str) -> String {
        self.issued += 1;
        let token = format!(
            "0.AXemulator.{}",
            URL_SAFE_NO_PAD.encode(format!("{email}/refresh/{}", self.issued))
        );
        self.rotated_refresh_tokens
            .insert(token.clone(), email.to_string());
        token
    }

    // -- sign-in --

    /// Records that the mailbox's owner signed in and consented, and
    /// answers the authorization code for it. The scopes add to the ones
    /// the grant already covers. A consent after a revocation starts a new
    /// grant, whose refresh tokens are new: the revoked ones stay dead.
    pub(crate) fn authorize(
        &mut self,
        email: &str,
        consent: Consent,
    ) -> Result<String, EmulatorError> {
        let expires_at = self.now() + Duration::seconds(AUTHORIZATION_CODE_LIFETIME_SECONDS);
        let mailbox = self.mailbox(email)?;
        let email = mailbox.email.clone();
        if mailbox.revoked {
            mailbox.revoked = false;
            mailbox.grants += 1;
            mailbox.refresh_token = format!("refresh-{email}-{}", mailbox.grants);
            mailbox.scopes.clear();
            self.rotated_refresh_tokens
                .retain(|_, owner| *owner != email);
        }
        let mailbox = self.mailbox(&email)?;
        for scope in &consent.scopes {
            if !mailbox.scopes.contains(scope) {
                mailbox.scopes.push(scope.clone());
            }
        }

        self.issued += 1;
        let code = format!(
            "0.AXemulator.{}",
            URL_SAFE_NO_PAD.encode(format!("{email}/code/{}", self.issued))
        );
        self.codes.insert(
            code.clone(),
            AuthorizationCode {
                email,
                consent,
                expires_at,
            },
        );
        Ok(code)
    }

    /// Redeems an authorization code, once, for the client and redirect URI
    /// it was issued to. `challenge` is the S256 challenge of the request's
    /// PKCE verifier.
    pub(crate) fn redeem_code(
        &mut self,
        code: &str,
        client_id: &str,
        redirect_uri: &str,
        challenge: Option<&str>,
    ) -> Result<Redeemed, CodeError> {
        let issued = self.codes.remove(code).ok_or(CodeError::Unknown)?;
        if issued.expires_at <= self.now() {
            return Err(CodeError::Expired);
        }
        if issued.consent.client_id != client_id {
            return Err(CodeError::Client);
        }
        if issued.consent.redirect_uri != redirect_uri {
            return Err(CodeError::RedirectUri);
        }
        if issued.consent.code_challenge.as_deref() != challenge {
            return Err(CodeError::Verifier);
        }
        Ok(Redeemed {
            email: issued.email,
            consent: issued.consent,
        })
    }

    /// Revokes the mailbox's grant: its tokens answer 401, refreshing
    /// answers `invalid_grant`, and its subscriptions are removed.
    pub(crate) fn revoke_grant(&mut self, email: &str) -> Result<(), EmulatorError> {
        let mailbox = self.mailbox(email)?;
        mailbox.revoked = true;
        let email = mailbox.email.clone();
        self.codes.retain(|_, code| code.email != email);
        let ids: Vec<String> = self
            .subscriptions
            .values()
            .filter(|subscription| subscription.email == email)
            .map(|subscription| subscription.id.clone())
            .collect();
        for id in ids {
            self.queue_lifecycle(&id, LifecycleEvent::SubscriptionRemoved);
            self.subscriptions.remove(&id);
        }
        Ok(())
    }

    // -- faults --

    pub(crate) fn inject_fault(&mut self, fault: Fault) -> u64 {
        self.next_fault += 1;
        self.faults.push((self.next_fault, fault));
        self.next_fault
    }

    pub(crate) fn faults(&self) -> Vec<(u64, Fault)> {
        self.faults.clone()
    }

    pub(crate) fn remove_fault(&mut self, id: u64) -> bool {
        let before = self.faults.len();
        self.faults.retain(|(fault_id, _)| *fault_id != id);
        self.faults.len() != before
    }

    pub(crate) fn clear_faults(&mut self) {
        self.faults.clear();
    }

    /// The first fault matching a request, counted against its `times`.
    pub(crate) fn take_fault(&mut self, mailbox: Option<&str>, route: Route) -> Option<Fault> {
        let index = self.faults.iter().position(|(_, fault)| {
            let mailbox_matches = fault.mailbox.as_deref().is_none_or(|wanted| {
                mailbox.is_some_and(|email| wanted.eq_ignore_ascii_case(email))
            });
            let route_matches = fault.route.is_none_or(|wanted| wanted == route);
            mailbox_matches && route_matches
        })?;
        let (_, fault) = self.faults.get_mut(index)?;
        let taken = fault.clone();
        if let Some(times) = &mut fault.times {
            *times = times.saturating_sub(1);
            if *times == 0 {
                self.faults.remove(index);
            }
        }
        Some(taken)
    }

    // -- mail --

    /// Delivers new mail to a mailbox, applying its inbox rules.
    pub(crate) fn deliver(
        &mut self,
        email: &str,
        message: &NewMessage,
    ) -> Result<Delivered, EmulatorError> {
        let now = self.now();
        let mailbox = self.mailbox(email)?;
        let id = mailbox.add_message(message, now)?;
        apply_rules(mailbox, &id, now);
        let stored = mailbox
            .messages
            .get(&id)
            .ok_or_else(|| EmulatorError::UnknownMessage(id.clone()))?;
        Ok(Delivered {
            id: stored.id.clone(),
            conversation_id: stored.conversation_id.clone(),
            folder_id: stored.folder_id.clone(),
        })
    }

    /// Sends a draft: it moves to Sent Items, and every recipient with a
    /// mailbox here receives a copy.
    pub(crate) fn send(&mut self, email: &str, message_id: &str) -> Result<(), GraphError> {
        let now = self.now();
        let mailbox = self
            .mailboxes
            .get_mut(email)
            .ok_or_else(GraphError::item_not_found)?;
        let sent = mailbox.mark_sent(message_id, now)?;
        let recipients = sent.to.iter().chain(&sent.cc).chain(&sent.bcc);
        let mut delivered = Vec::new();
        for recipient in recipients {
            let address = recipient.address.to_lowercase();
            if delivered.contains(&address) {
                continue;
            }
            if let Some(mailbox) = self.mailboxes.get_mut(&address) {
                let id = mailbox.receive(&sent, now);
                apply_rules(mailbox, &id, now);
            }
            delivered.push(address);
        }
        Ok(())
    }

    // -- subscriptions and notifications --

    /// Removes subscriptions past their expiry, as Graph does silently.
    pub(crate) fn sweep(&mut self) {
        let now = self.now();
        self.subscriptions
            .retain(|_, subscription| subscription.expires_at > now);
        self.uploads.retain(|_, upload| upload.expires_at > now);
    }

    /// Turns the mailboxes' pending message changes into notifications for
    /// the subscriptions watching them: one POST per subscription.
    pub(crate) fn collect_notifications(&mut self) {
        let mut jobs = Vec::new();
        for mailbox in self.mailboxes.values_mut() {
            if mailbox.changes.is_empty() {
                continue;
            }
            let changes = std::mem::take(&mut mailbox.changes);
            let subscriptions = self
                .subscriptions
                .values()
                .filter(|subscription| subscription.email == mailbox.email);
            for subscription in subscriptions {
                let items: Vec<Value> = changes
                    .iter()
                    .filter(|change| watches(subscription, mailbox, change))
                    .map(|change| change_notification(subscription, mailbox, change))
                    .collect();
                if !items.is_empty() {
                    jobs.push(NotificationJob {
                        subscription_id: subscription.id.clone(),
                        url: subscription.notification_url.clone(),
                        kind: "change",
                        body: json!({ "value": items }),
                    });
                }
            }
        }
        self.outbox.extend(jobs);
    }

    /// Queues a lifecycle notification, when the subscription has a
    /// lifecycle URL. Answers whether it was queued.
    pub(crate) fn queue_lifecycle(&mut self, subscription_id: &str, event: LifecycleEvent) -> bool {
        let Some(subscription) = self.subscriptions.get(subscription_id) else {
            return false;
        };
        let Some(url) = subscription.lifecycle_url.clone() else {
            return false;
        };
        let tenant = self
            .mailboxes
            .get(&subscription.email)
            .map(|mailbox| mailbox.tenant_id.clone());
        let body = json!({"value": [{
            "subscriptionId": subscription.id,
            "subscriptionExpirationDateTime": render::time(subscription.expires_at),
            "tenantId": tenant,
            "organizationId": tenant,
            "clientState": subscription.client_state,
            "lifecycleEvent": event,
        }]});
        self.outbox.push(NotificationJob {
            subscription_id: subscription.id.clone(),
            url,
            kind: "lifecycle",
            body,
        });
        true
    }
}

/// Whether a subscription's resource and change types cover a change.
fn watches(subscription: &Subscription, mailbox: &Mailbox, change: &Change) -> bool {
    let wanted = match change.kind {
        ChangeKind::Created => "created",
        ChangeKind::Updated => "updated",
        ChangeKind::Deleted => "deleted",
    };
    let change_types = subscription.change_type.to_lowercase();
    if !change_types.split(',').any(|kind| kind.trim() == wanted) {
        return false;
    }

    // `me/messages`, or one folder's: `me/mailFolders('inbox')/messages`.
    let resource = subscription.resource.to_lowercase();
    let Some(folder) = resource
        .split("mailfolders")
        .nth(1)
        .and_then(|rest| rest.strip_suffix("/messages"))
    else {
        return true;
    };
    let key = folder.trim_matches(|c| matches!(c, '/' | '(' | ')' | '\''));
    mailbox.folders.iter().any(|folder| {
        let named = folder.id.to_lowercase() == key || folder.well_known == Some(key);
        named && folder.id == change.folder_id
    })
}

fn change_notification(subscription: &Subscription, mailbox: &Mailbox, change: &Change) -> Value {
    let resource = format!("Users/{}/Messages/{}", mailbox.user_id, change.message_id);
    json!({
        "subscriptionId": subscription.id,
        "subscriptionExpirationDateTime": render::time(subscription.expires_at),
        "changeType": match change.kind {
            ChangeKind::Created => "created",
            ChangeKind::Updated => "updated",
            ChangeKind::Deleted => "deleted",
        },
        "resource": resource,
        "resourceData": {
            "@odata.type": "#Microsoft.Graph.Message",
            "@odata.id": resource,
            "@odata.etag": change.etag,
            "id": change.message_id,
        },
        "clientState": subscription.client_state,
        "tenantId": mailbox.tenant_id,
    })
}

/// Applies the inbox rules to a delivered message: a rule whose
/// `fromAddresses` name the sender and whose action is `delete` moves it to
/// Deleted Items.
fn apply_rules(mailbox: &mut Mailbox, message_id: &str, now: DateTime<Utc>) {
    let Some(message) = mailbox.messages.get(message_id) else {
        return;
    };
    let in_inbox = mailbox
        .well_known("inbox")
        .is_some_and(|inbox| inbox.id == message.folder_id);
    let Some(sender) = message
        .from
        .as_ref()
        .map(|from| from.address.to_lowercase())
    else {
        return;
    };
    let deletes = mailbox.rules.iter().any(|rule| {
        let from_sender = rule
            .pointer("/conditions/fromAddresses")
            .and_then(Value::as_array)
            .is_some_and(|addresses| {
                addresses.iter().any(|address| {
                    address
                        .pointer("/emailAddress/address")
                        .and_then(Value::as_str)
                        .is_some_and(|address| address.eq_ignore_ascii_case(&sender))
                })
            });
        rule["isEnabled"] == true && rule["actions"]["delete"] == true && from_sender
    });
    if in_inbox && deletes {
        // The folder exists in every mailbox, so the move cannot fail.
        let _moved = mailbox.move_message(message_id, "deleteditems", now);
    }
}
