//! The real `email_api_client` Outlook adapter against the emulator.

mod control;
mod drafts;
mod faults;
mod mail;
mod sign_in;
mod subscriptions;
mod sync;

use email_api_client::OutlookApiClientRepository;
use email_api_client::domain::models::{AccessToken, ProviderId};
use macro_service_urls::MicrosoftGraphUrl;

use crate::{OutlookEmulator, Seed};

const ADA: &str = "ada@example.com";
const BOB: &str = "bob@example.com";

/// An emulator seeded from YAML, and the real client pointed at it.
async fn start(seed: &str) -> (OutlookEmulator, OutlookApiClientRepository) {
    let emulator = OutlookEmulator::start(Seed::parse(seed).unwrap())
        .await
        .unwrap();
    let url = MicrosoftGraphUrl::from(emulator.graph_url());
    let api = OutlookApiClientRepository::for_graph_url(&url).unwrap();
    (emulator, api)
}

fn token(emulator: &OutlookEmulator, email: &str) -> AccessToken {
    AccessToken::new(emulator.access_token(email).unwrap())
}

fn id(value: &str) -> ProviderId {
    ProviderId::new(value).unwrap()
}

/// The emulator's id of the message with a subject.
fn message_id(emulator: &OutlookEmulator, email: &str, subject: &str) -> ProviderId {
    let messages = emulator.messages(email).unwrap();
    let message = messages
        .iter()
        .find(|message| message.subject == subject)
        .unwrap();
    id(&message.id)
}
