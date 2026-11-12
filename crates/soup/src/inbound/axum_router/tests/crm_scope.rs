//! `POST /soup/ast` with a CRM email scope (`ecd` / `eca`) that email
//! rejects, through the real Soup service: email threads drop out of the page
//! and every other source still answers.
use super::*;
use crate::domain::{
    ports::MockSoupRepo,
    service::{
        SoupImpl,
        tests::{
            NoopCallRecordQueryService, NoopCommsService, NoopPullRequestListing,
            crm_scope::{FailingEmailPreviewService, MakeEmailErr},
            soup_document_uuid_with_updated,
        },
    },
};
use crm::domain::service::NoOpCrmService;
use entity_access::domain::models::{TeamRole, UserTeamInfo};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::mock::MockFrecencyStorage};
use models_soup::item::SoupItem;

const TEAM: Uuid = Uuid::from_u128(0x7e);
const DOCUMENT: Uuid = Uuid::from_u128(0xd0c);

/// Posts `body` to `/soup/ast` as a team member, with email previews
/// failing with the error `make` builds. Returns the response and how many
/// times email was asked for previews.
async fn post_crm_scoped_ast(
    body: serde_json::Value,
    make: MakeEmailErr,
) -> (StatusCode, serde_json::Value, usize) {
    let mut repo = MockSoupRepo::new();
    repo.expect_expanded_generic_cursor_soup().returning(|_| {
        Box::pin(async {
            Ok(vec![SoupItem::Document(soup_document_uuid_with_updated(
                DOCUMENT,
                Default::default(),
            ))])
        })
    });
    repo.expect_populate_properties().returning(|_, items| {
        Box::pin(async move {
            Ok(items
                .into_iter()
                .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
                .collect())
        })
    });
    let mut frecency = MockFrecencyStorage::new();
    frecency
        .expect_get_aggregate_for_user_entities()
        .returning(|_, _| Box::pin(async { Ok(Vec::new()) }));
    let calls = Arc::new(std::sync::Mutex::new(0));
    let service = SoupImpl::new(
        repo,
        FrecencyQueryServiceImpl::new(frecency),
        FailingEmailPreviewService {
            make,
            calls: calls.clone(),
        },
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopPullRequestListing,
    );
    let router = soup_router(SoupRouterState::new(
        service,
        MockEmail,
        Arc::new(MockEntityAccess {
            team: Some(UserTeamInfo {
                team_id: TEAM,
                role: TeamRole::Member,
            }),
        }),
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ));

    let request = authenticated_request()
        .uri("/soup/ast")
        .method(Method::POST)
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let (status, body) = send_json(router, request).await;
    let calls = *calls.lock().unwrap();
    (status, body, calls)
}

fn item_ids(body: &serde_json::Value) -> Vec<&str> {
    body["items"]
        .as_array()
        .expect("a page of items")
        .iter()
        .map(|item| item["data"]["id"].as_str().expect("item id"))
        .collect()
}

async fn assert_email_threads_omitted(body: serde_json::Value, make: MakeEmailErr, name: &str) {
    let (status, body, calls) = post_crm_scoped_ast(body, make).await;

    assert_eq!(status, StatusCode::OK, "{name}: {body}");
    assert_eq!(calls, 1, "{name}: email was asked for the scoped threads");
    assert_eq!(
        item_ids(&body),
        vec![DOCUMENT.to_string()],
        "{name}: other sources keep their items"
    );
}

#[tokio::test]
async fn not_permitted_crm_address_omits_email_threads() {
    assert_email_threads_omitted(
        json!({ "eca": ["contact@example.com"] }),
        || EmailErr::CrmAddressNotPermitted("contact@example.com".to_string()),
        "CrmAddressNotPermitted",
    )
    .await;
}

#[tokio::test]
async fn unknown_crm_address_omits_email_threads() {
    assert_email_threads_omitted(
        json!({ "eca": ["contact@example.com"] }),
        || EmailErr::CrmAddressNotFound("contact@example.com".to_string()),
        "CrmAddressNotFound",
    )
    .await;
}

#[tokio::test]
async fn rejected_crm_domain_omits_email_threads() {
    assert_email_threads_omitted(
        json!({ "ecd": ["example.com"] }),
        || EmailErr::CrmDomainNotPermitted("example.com".to_string()),
        "CrmDomainNotPermitted",
    )
    .await;
}

#[tokio::test]
async fn other_email_failures_stay_server_errors() {
    let (status, body, calls) = post_crm_scoped_ast(json!({ "eca": ["contact@example.com"] }), || {
        EmailErr::RepoErr(anyhow::anyhow!("database unavailable"))
    })
    .await;

    assert_eq!(calls, 1);
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
}
