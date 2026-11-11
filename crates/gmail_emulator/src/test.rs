//! The real `gmail_client` and `email_api_client` Gmail adapter running
//! against the emulator.

mod auth;
mod control;
mod faults;
mod history;
mod mail;
mod people;
mod push;
mod sign_in;

use email_api_client::GmailApiClientRepository;
use email_api_client::domain::models::AccessToken;
use gmail_client::GmailClient;

use crate::{DEFAULT_PUSH_AUDIENCE, GmailEmulator, NewMessage, Seed, SeedMailbox};

const ADA: &str = "ada@example.com";
const BOB: &str = "bob@example.com";
const TOPIC: &str = "projects/test/topics/gmail";

/// The production Gmail client, pointed at the emulator.
fn client(emulator: &GmailEmulator) -> GmailClient {
    GmailClient::new_with_urls(
        Some(TOPIC.to_string()),
        emulator.gmail_url(),
        emulator.people_url(),
        emulator.certs_url(),
        DEFAULT_PUSH_AUDIENCE.to_string(),
    )
}

/// The production Gmail adapter of `email_api_client`, pointed at the emulator.
fn repository(emulator: &GmailEmulator) -> GmailApiClientRepository {
    GmailApiClientRepository::new(client(emulator))
}

async fn two_mailboxes() -> GmailEmulator {
    GmailEmulator::start(Seed::with_mailboxes([ADA, BOB]))
        .await
        .unwrap()
}

fn token(emulator: &GmailEmulator, email: &str) -> AccessToken {
    AccessToken::new(emulator.access_token(email).unwrap())
}

fn mail(from: &str, subject: &str, text: &str) -> NewMessage {
    NewMessage {
        from: Some(from.to_string()),
        subject: Some(subject.to_string()),
        text: Some(text.to_string()),
        ..NewMessage::default()
    }
}

fn mailbox_with(email: &str, messages: Vec<NewMessage>) -> SeedMailbox {
    SeedMailbox {
        messages,
        ..SeedMailbox::new(email)
    }
}
