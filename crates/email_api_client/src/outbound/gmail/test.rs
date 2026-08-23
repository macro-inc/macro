mod attachments;
mod blocklist;
mod contacts;
mod error;
mod labels;
mod messages;
mod send;
mod subscription;
mod sync;

use gmail_client::GmailClient;
use wiremock::MockServer;

use super::GmailApiClientRepository;

async fn repository() -> (MockServer, GmailApiClientRepository) {
    let server = MockServer::start().await;
    let url = server.uri();
    let client = GmailClient::new_with_urls(
        "topic".to_string(),
        url.clone(),
        url.clone(),
        format!("{url}/certs"),
        "audience".to_string(),
    );
    (server, GmailApiClientRepository::new(client))
}
