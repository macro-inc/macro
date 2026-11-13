//! Push notifications: what Pub/Sub posts to a push subscription's webhook
//! when a watched mailbox changes, with the signed token Pub/Sub attaches,
//! and what Google Calendar posts to a channel's address when a watched
//! calendar changes.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use rsa::RsaPrivateKey;
use rsa::pkcs1::EncodeRsaPrivateKey;
use rsa::traits::PublicKeyParts;
use serde::Serialize;
use serde_json::json;
use tokio::sync::mpsc;

use crate::calendar::ChannelNotification;
use crate::seed::PushConfig;
use crate::state::PushJob;
use crate::{ChannelDelivery, GmailEmulator, PushDelivery};

const SIGNING_KEY_ID: &str = "gmail-emulator-push-key-1";
const SIGNING_KEY_BITS: usize = 2048;
pub(crate) const ISSUER: &str = "https://accounts.google.com";
const SERVICE_ACCOUNT: &str = "gmail-emulator-push@emulator.example.com";
const SERVICE_ACCOUNT_ID: &str = "100000000000000000001";
const TOKEN_LIFETIME_SECONDS: i64 = 3600;
/// Pub/Sub redelivers until the webhook acknowledges; the emulator stops here.
const MAX_ATTEMPTS: u8 = 5;
const FIRST_RETRY_DELAY: Duration = Duration::from_millis(250);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// The statuses Pub/Sub takes as an acknowledgement.
const ACKNOWLEDGED: [u16; 5] = [102, 200, 201, 202, 204];
/// The statuses after which Google Calendar sends a notification again.
const CHANNEL_RETRIED: [u16; 4] = [500, 502, 503, 504];
const CHANNEL_EXPIRATION: &str = "%a, %d %b %Y %H:%M:%S GMT";

/// The key that signs push tokens, and its public half as Google's
/// certificates endpoint would serve it.
pub(crate) struct SigningKey {
    encoding: EncodingKey,
    pub(crate) jwks: String,
}

/// Why the signing key could not be made.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SigningKeyError {
    /// Key generation failed.
    #[error("could not generate the push signing key: {0}")]
    Generate(#[from] rsa::Error),
    /// The key could not be encoded for signing.
    #[error("could not encode the push signing key: {0}")]
    Encode(#[from] rsa::pkcs1::Error),
    /// Key generation was cancelled.
    #[error("push signing key generation did not finish: {0}")]
    Cancelled(#[from] tokio::task::JoinError),
}

impl SigningKey {
    /// Generates a key. Every emulator has its own, so no private key is
    /// kept in the repository and none signs anything a real service trusts.
    pub(crate) fn generate() -> Result<Self, SigningKeyError> {
        let key = RsaPrivateKey::new(&mut rsa::rand_core::OsRng, SIGNING_KEY_BITS)?;
        let der = key.to_pkcs1_der()?;
        let jwks = json!({
            "keys": [{
                "kty": "RSA",
                "alg": "RS256",
                "use": "sig",
                "kid": SIGNING_KEY_ID,
                "n": URL_SAFE_NO_PAD.encode(key.n().to_bytes_be()),
                "e": URL_SAFE_NO_PAD.encode(key.e().to_bytes_be()),
            }]
        });

        Ok(Self {
            encoding: EncodingKey::from_rsa_der(der.as_bytes()),
            jwks: jwks.to_string(),
        })
    }

    /// Signs a token the certificates endpoint's key verifies.
    pub(crate) fn sign(
        &self,
        claims: &impl Serialize,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(SIGNING_KEY_ID.to_string());
        jsonwebtoken::encode(&header, claims, &self.encoding)
    }
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    aud: &'a str,
    azp: &'a str,
    sub: &'a str,
    email: &'a str,
    email_verified: bool,
    iat: i64,
    exp: i64,
}

/// Signs the token Pub/Sub would attach. It is dated by the real clock,
/// because that is the clock its verifier reads.
pub(crate) fn signed_token(
    key: &SigningKey,
    audience: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let issued_at = Utc::now().timestamp();

    key.sign(&Claims {
        iss: ISSUER,
        aud: audience,
        azp: SERVICE_ACCOUNT_ID,
        sub: SERVICE_ACCOUNT_ID,
        email: SERVICE_ACCOUNT,
        email_verified: true,
        iat: issued_at,
        exp: issued_at + TOKEN_LIFETIME_SECONDS,
    })
}

/// The body Pub/Sub posts for a Gmail watch notification.
fn envelope(email: &str, history_id: u64, topic: &str, sequence: u64) -> serde_json::Value {
    let data = json!({ "emailAddress": email, "historyId": history_id });
    let message_id = sequence.to_string();
    let publish_time = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let subscription = format!("{}-push", topic.replace("/topics/", "/subscriptions/"));

    json!({
        "message": {
            "data": STANDARD.encode(data.to_string()),
            "messageId": message_id,
            "message_id": message_id,
            "publishTime": publish_time,
            "publish_time": publish_time,
        },
        "subscription": subscription,
    })
}

async fn post(
    http: &reqwest::Client,
    emulator: &GmailEmulator,
    config: &PushConfig,
    body: &serde_json::Value,
) -> Result<u16, String> {
    let key = emulator
        .signing_key()
        .await
        .map_err(|error| error.to_string())?;
    let token = signed_token(key, &config.audience).map_err(|error| error.to_string())?;
    http.post(&config.endpoint)
        .bearer_auth(token)
        .json(body)
        .send()
        .await
        .map(|response| response.status().as_u16())
        .map_err(|error| error.without_url().to_string())
}

/// Delivers each queued notification to the push endpoint, retrying one the
/// webhook does not acknowledge, and records the outcome.
pub(crate) async fn deliver_jobs(
    emulator: GmailEmulator,
    mut jobs: mpsc::UnboundedReceiver<PushJob>,
) {
    let http = match reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build() {
        Ok(http) => http,
        Err(error) => {
            tracing::error!(error = ?error, "push delivery has no HTTP client");
            return;
        }
    };
    let cancel = emulator.inner.cancel.clone();
    let mut sequence: u64 = 0;

    loop {
        let job = tokio::select! {
            () = cancel.cancelled() => return,
            job = jobs.recv() => match job {
                Some(job) => job,
                None => return,
            },
        };
        let (email, history_id, topic) = match job {
            PushJob::Mailbox {
                email,
                history_id,
                topic,
            } => (email, history_id, topic),
            PushJob::Channel(notification) => {
                if notify_channel(&http, &emulator, notification)
                    .await
                    .is_none()
                {
                    return;
                }
                continue;
            }
        };
        let Some(config) = emulator.push_config() else {
            continue;
        };

        sequence += 1;
        let body = envelope(&email, history_id, &topic, sequence);
        let mut attempts = 0;
        let mut delay = FIRST_RETRY_DELAY;
        let outcome = loop {
            attempts += 1;
            let outcome = post(&http, &emulator, &config, &body).await;
            let acknowledged = matches!(outcome, Ok(status) if ACKNOWLEDGED.contains(&status));
            if acknowledged || attempts == MAX_ATTEMPTS {
                break outcome;
            }

            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(delay) => {}
            }
            delay *= 2;
        };

        emulator.with_state(|state| {
            let at = state.now();
            state.deliveries.push(PushDelivery {
                at,
                mailbox: email,
                history_id,
                endpoint: config.endpoint,
                status: outcome.as_ref().ok().copied(),
                error: outcome.err(),
                attempts,
            });
        });
    }
}

/// Posts one Calendar notification the way Google does: no body, the
/// channel and resource in `X-Goog-` headers, and the token the client gave
/// the channel. Returns `None` when the emulator is shutting down.
async fn notify_channel(
    http: &reqwest::Client,
    emulator: &GmailEmulator,
    notification: ChannelNotification,
) -> Option<()> {
    let cancel = emulator.inner.cancel.clone();
    let expiration = chrono::DateTime::from_timestamp_millis(notification.expires_at_ms)
        .unwrap_or_else(Utc::now)
        .format(CHANNEL_EXPIRATION)
        .to_string();
    let mut attempts = 0;
    let mut delay = FIRST_RETRY_DELAY;

    let outcome = loop {
        attempts += 1;
        let mut request = http
            .post(&notification.address)
            .header("X-Goog-Channel-ID", &notification.channel_id)
            .header("X-Goog-Channel-Expiration", &expiration)
            .header("X-Goog-Resource-ID", &notification.resource_id)
            .header("X-Goog-Resource-URI", &notification.resource_uri)
            .header("X-Goog-Resource-State", notification.state.to_string())
            .header(
                "X-Goog-Message-Number",
                notification.message_number.to_string(),
            )
            .header(reqwest::header::CONTENT_LENGTH, 0);
        if let Some(token) = &notification.token {
            request = request.header("X-Goog-Channel-Token", token);
        }
        let outcome = request
            .send()
            .await
            .map(|response| response.status().as_u16())
            .map_err(|error| error.without_url().to_string());

        let retried = match &outcome {
            Ok(status) => CHANNEL_RETRIED.contains(status),
            Err(_) => true,
        };
        if !retried || attempts == MAX_ATTEMPTS {
            break outcome;
        }
        tokio::select! {
            () = cancel.cancelled() => return None,
            () = tokio::time::sleep(delay) => {}
        }
        delay *= 2;
    };

    emulator.with_state(|state| {
        let at = state.now();
        state.channel_deliveries.push(ChannelDelivery {
            at,
            mailbox: notification.mailbox,
            calendar_id: notification.calendar_id,
            channel_id: notification.channel_id,
            resource_id: notification.resource_id,
            resource_state: notification.state,
            message_number: notification.message_number,
            address: notification.address,
            status: outcome.as_ref().ok().copied(),
            error: outcome.err(),
            attempts,
        });
    });
    Some(())
}
