use bot_id::BotId;
use model_owner::Owner;
use shared_entity_registry::RegisteredEntityType;
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

use super::PurgeOwnedEntityError;
use crate::DocumentStorageServiceClient;

const INTERNAL_KEY: &str = "internal-key";
const BOT: Uuid = Uuid::from_u128(0xB07);
const DOCUMENT: Uuid = Uuid::from_u128(0xD0C);

async fn dss_answering(response: ResponseTemplate) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path(format!("/internal/owned/document/{DOCUMENT}")))
        .and(query_param("owner", format!("bot|{BOT}")))
        .and(header("x-document-storage-service-auth-key", INTERNAL_KEY))
        .respond_with(response)
        .expect(1)
        .mount(&server)
        .await;
    server
}

async fn purge_bot_document(dss_url: String) -> Result<(), PurgeOwnedEntityError> {
    DocumentStorageServiceClient::new(INTERNAL_KEY.into(), dss_url)
        .purge_owned_entity(
            RegisteredEntityType::Document,
            DOCUMENT,
            &Owner::Bot(BotId::new_from_uuid(BOT)),
        )
        .await
        .map_err(|report| *report.current_context())
}

#[tokio::test]
async fn no_content_is_a_purge() {
    let server = dss_answering(ResponseTemplate::new(204)).await;

    assert_eq!(purge_bot_document(server.uri()).await, Ok(()));
}

#[tokio::test]
async fn conflict_is_owned_elsewhere() {
    let server = dss_answering(ResponseTemplate::new(409)).await;

    assert_eq!(
        purge_bot_document(server.uri()).await,
        Err(PurgeOwnedEntityError::OwnedElsewhere)
    );
}

#[tokio::test]
async fn any_other_status_is_an_unexpected_response() {
    for status in [200, 400, 401, 404, 500] {
        let server = dss_answering(ResponseTemplate::new(status)).await;

        assert_eq!(
            purge_bot_document(server.uri()).await,
            Err(PurgeOwnedEntityError::UnexpectedResponse { status }),
            "{status}"
        );
    }
}

#[tokio::test]
async fn a_refused_connection_is_unreachable() {
    let closed_port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();

    assert_eq!(
        purge_bot_document(format!("http://127.0.0.1:{closed_port}")).await,
        Err(PurgeOwnedEntityError::Unreachable)
    );
}
