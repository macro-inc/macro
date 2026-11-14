use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike as _;
use models_search::SearchHighlight;
use models_search::channel::{ChannelNameSearchResponse, ChannelNameSearchResponseItem};
use models_search::document::{
    DocumentMetadata, DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata,
};
use models_search::project::{
    ProjectMetadata, ProjectSearchResponseItem, ProjectSearchResponseItemWithMetadata,
};
use models_search::unified::UnifiedSearchResponse;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const OWNER: &str = "macro|owner@example.com";
/// The search's internal key and user headers (document storage's).
const KEY_HEADER: &str = "x-document-storage-service-auth-key";
const USER_HEADER: &str = "x-document-storage-service-user-id";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap().into_owned()
}

fn names(server: &MockServer) -> SearchNames {
    SearchNames::new(SearchServiceClient::new("key".to_owned(), server.uri()))
}

fn asked(name: &str, kinds: &[ItemKind]) -> NameAsked {
    NameAsked {
        name: name.to_owned(),
        kinds: kinds.to_vec(),
    }
}

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn at() -> DateTime<Utc> {
    DateTime::UNIX_EPOCH
}

fn channel(n: u128, highlighted: &str) -> ChannelNameSearchResponseItem {
    ChannelNameSearchResponseItem {
        metadata: None,
        id: id(n),
        owner_id: None,
        channel_type: "public".to_owned(),
        channel_id: id(n),
        highlight: SearchHighlight {
            name: Some(highlighted.to_owned()),
            ..SearchHighlight::default()
        },
        score: None,
    }
}

fn document(
    n: u128,
    name: &str,
    sub_type: Option<DocumentSubType>,
    deleted: bool,
) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
        metadata: Some(DocumentMetadata {
            created_at: at(),
            updated_at: at(),
            viewed_at: None,
            project_id: None,
            deleted_at: deleted.then(at),
        }),
        properties: None,
        extra: DocumentSearchResponseItem {
            id: id(n),
            name: name.to_owned(),
            owner_id: OWNER.to_owned(),
            document_id: id(n),
            document_name: name.to_owned(),
            file_type: Some("md".to_owned()),
            sub_type,
            document_search_results: Vec::new(),
        },
    })
}

fn folder(n: u128, name: &str) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::Project(ProjectSearchResponseItemWithMetadata {
        metadata: Some(ProjectMetadata {
            created_at: at(),
            updated_at: at(),
            viewed_at: None,
            parent_project_id: None,
            deleted_at: None,
        }),
        properties: None,
        extra: ProjectSearchResponseItem {
            id: id(n),
            name: name.to_owned(),
            owner_id: OWNER.to_owned(),
            updated_at: at(),
            created_at: at(),
            project_search_results: Vec::new(),
        },
    })
}

async fn channels_answer(
    server: &MockServer,
    query: &str,
    results: Vec<ChannelNameSearchResponseItem>,
) {
    Mock::given(method("POST"))
        .and(path("/internal/search/channel/name"))
        .and(header(KEY_HEADER, "key"))
        .and(header(USER_HEADER, OWNER))
        .and(body_partial_json(
            json!({ "query": query, "match_type": "exact" }),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(ChannelNameSearchResponse {
                results,
                next_cursor: None,
            }),
        )
        .expect(1)
        .mount(server)
        .await;
}

async fn index_answers(server: &MockServer, query: &str, results: Vec<UnifiedSearchResponseItem>) {
    Mock::given(method("POST"))
        .and(path("/internal/search"))
        .and(header(KEY_HEADER, "key"))
        .and(header(USER_HEADER, OWNER))
        .and(body_partial_json(json!({
            "query": query,
            "match_type": "exact",
            "search_on": "name",
        })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(UnifiedSearchResponse {
                results,
                next_cursor: None,
            }),
        )
        .expect(1)
        .mount(server)
        .await;
}

fn item(kind: ItemKind, n: u128, name: &str, exact: bool) -> NameMatch {
    NameMatch {
        name: name.to_owned(),
        exact,
        kind,
        id: id(n).to_string(),
        definition_id: None,
    }
}

#[tokio::test]
async fn names_are_searched_as_the_owner_and_compared_exactly() {
    let server = MockServer::start().await;
    channels_answer(
        &server,
        "design",
        vec![
            channel(1, "<macro_em>design</macro_em>-feedback"),
            channel(2, "<macro_em>Design</macro_em>"),
        ],
    )
    .await;
    index_answers(
        &server,
        "Weekly metrics",
        vec![
            document(3, "Weekly metrics Q3", None, false),
            document(4, "weekly  metrics", Some(DocumentSubType::Task), false),
            // Gone, or an initiative's description: not items to pick.
            document(5, "Weekly metrics", None, true),
            document(
                6,
                "Weekly metrics",
                Some(DocumentSubType::InitiativeDescription),
                false,
            ),
        ],
    )
    .await;
    channels_answer(&server, "Launch", Vec::new()).await;
    index_answers(&server, "Launch", vec![folder(7, "Launch")]).await;

    let answers = names(&server)
        .look_up(
            &owner(),
            &[
                asked("#design", &[ItemKind::Channel]),
                asked("Weekly metrics", &[ItemKind::Task, ItemKind::Document]),
                asked("Launch", &[]),
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        answers,
        NameAnswers {
            answers: vec![
                NameAnswer {
                    name: "#design".to_owned(),
                    matches: vec![
                        item(ItemKind::Channel, 2, "Design", true),
                        item(ItemKind::Channel, 1, "design-feedback", false),
                    ],
                },
                NameAnswer {
                    name: "Weekly metrics".to_owned(),
                    matches: vec![
                        item(ItemKind::Task, 4, "weekly  metrics", true),
                        item(ItemKind::Document, 3, "Weekly metrics Q3", false),
                    ],
                },
                NameAnswer {
                    name: "Launch".to_owned(),
                    matches: vec![item(ItemKind::Project, 7, "Launch", true)],
                },
            ],
            unavailable: Vec::new(),
        }
    );
}

#[tokio::test]
async fn a_kind_whose_search_fails_is_unavailable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/internal/search/channel/name"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    index_answers(&server, "Launch", vec![folder(7, "Launch")]).await;

    let answers = names(&server)
        .look_up(
            &owner(),
            &[asked("Launch", &[ItemKind::Channel, ItemKind::Project])],
        )
        .await
        .unwrap();

    assert_eq!(
        answers,
        NameAnswers {
            answers: vec![NameAnswer {
                name: "Launch".to_owned(),
                matches: vec![item(ItemKind::Project, 7, "Launch", true)],
            }],
            unavailable: vec![ItemKind::Channel],
        }
    );
}

#[tokio::test]
async fn a_lookup_whose_every_search_fails_is_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let looked_up = names(&server)
        .look_up(&owner(), &[asked("Finance", &[])])
        .await;

    assert!(looked_up.is_err());
}

#[test]
fn it_looks_up_channels_folders_documents_and_tasks() {
    let names = SearchNames::new(SearchServiceClient::new(
        "key".to_owned(),
        "http://search.invalid".to_owned(),
    ));

    assert_eq!(
        names.kinds(),
        [
            ItemKind::Channel,
            ItemKind::Project,
            ItemKind::Document,
            ItemKind::Task
        ]
    );
}
