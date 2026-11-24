use chrono::Utc;
use models_search::SearchHighlight;
use models_search::agent_session::AgentSessionSearchResponseItem;
use models_search::channel::ChannelMessageSearchResponseItem;
use models_search::document::{DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata};
use models_search::project::{ProjectSearchResponseItem, ProjectSearchResponseItemWithMetadata};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

use super::*;
use crate::domain::model::Token;

const NIL: &str = "00000000-0000-0000-0000-000000000000";

fn document(id: Uuid) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
        metadata: None,
        properties: None,
        extra: DocumentSearchResponseItem {
            id,
            name: String::new(),
            owner_id: String::new(),
            document_id: id,
            document_name: String::new(),
            file_type: None,
            sub_type: None,
            document_search_results: Vec::new(),
        },
    })
}

fn project(id: Uuid) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::Project(ProjectSearchResponseItemWithMetadata {
        metadata: None,
        properties: None,
        extra: ProjectSearchResponseItem {
            id,
            name: String::new(),
            owner_id: String::new(),
            updated_at: Utc::now(),
            created_at: Utc::now(),
            project_search_results: Vec::new(),
        },
    })
}

fn session(id: Uuid, name: &str) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::AgentSession(AgentSessionSearchResponseItem {
        id,
        name: name.to_owned(),
        owner_id: String::new(),
        bot_id: Uuid::nil(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        agent_session_search_results: Vec::new(),
    })
}

fn message(channel: Uuid, id: Uuid, deleted: bool) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::ChannelMessage(ChannelMessageSearchResponseItem {
        id: channel,
        owner_id: None,
        channel_type: "private".to_owned(),
        channel_id: channel,
        message_id: id,
        thread_id: None,
        sender_id: String::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        deleted_at: deleted.then(Utc::now),
        highlight: SearchHighlight::default(),
        score: None,
    })
}

/// A server answering every search with `results`, and the searcher.
async fn answering(results: Vec<UnifiedSearchResponseItem>) -> (MockServer, UnifiedSearch) {
    let server = MockServer::start().await;
    let body = serde_json::to_value(UnifiedSearchResponse {
        results,
        next_cursor: None,
        query_filters: None,
    })
    .expect("a response");
    Mock::given(method("POST"))
        .and(path("/dss/search"))
        .and(query_param("page_size", "10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(&server)
        .await;
    let api = MacroApi::new(&server.uri(), "mak_key").expect("a valid key");
    (server, UnifiedSearch::new(api))
}

async fn sent(server: &MockServer) -> Value {
    let requests: Vec<Request> = server.received_requests().await.expect("recorded");
    let [request] = requests.as_slice() else {
        panic!("one search, got {}", requests.len());
    };
    request.body_json().expect("a JSON body")
}

#[tokio::test]
async fn a_text_search_asks_for_the_exact_token_in_one_entity_type() {
    let wanted = Uuid::new_v4();
    let (server, search) = answering(vec![project(wanted), document(Uuid::new_v4())]).await;
    let token = Token::random();

    let hits = search
        .hits(&SearchQuery::Text {
            entity_type: EntityType::Project,
            token: token.clone(),
        })
        .await
        .expect("searched");

    // Only the project counts, though search answered a document too.
    assert_eq!(hits, [EntityId(wanted)]);
    let body = sent(&server).await;
    assert_eq!(body["query"], token.as_str());
    assert_eq!(body["match_type"], "exact");
    assert_eq!(body["search_on"], "name_content");
    assert_eq!(
        body["filters"]["document_filters"]["document_ids"],
        json!([NIL])
    );
    assert_eq!(body["filters"]["project_filters"].get("project_ids"), None);
}

#[tokio::test]
async fn a_message_hit_is_its_own_id_and_a_deleted_one_is_not_a_hit() {
    let channel = Uuid::new_v4();
    let live = Uuid::new_v4();
    let (_server, search) = answering(vec![
        message(channel, live, false),
        message(channel, Uuid::new_v4(), true),
    ])
    .await;

    let hits = search
        .hits(&SearchQuery::Text {
            entity_type: EntityType::Message,
            token: Token::random(),
        })
        .await
        .expect("searched");

    assert_eq!(hits, [EntityId(live)]);
}

#[tokio::test]
async fn a_property_search_filters_a_title_search_by_the_value() {
    let document_id = Uuid::new_v4();
    let (server, search) = answering(vec![document(document_id)]).await;
    let property = EntityId(Uuid::new_v4());
    let name = Token::random();
    let value = Token::random();

    let hits = search
        .hits(&SearchQuery::Property {
            property_id: property,
            name: name.clone(),
            value: value.clone(),
        })
        .await
        .expect("searched");

    assert_eq!(hits, [EntityId(document_id)]);
    let body = sent(&server).await;
    assert_eq!(body["query"], name.as_str());
    assert_eq!(body["search_on"], "name");
    assert_eq!(
        body["filters"]["property_filters"],
        json!([{
            "property_definition_id": property.to_string(),
            "option_ids": [value.as_str()],
        }])
    );
}

#[tokio::test]
async fn a_fixture_is_an_agent_session_titled_as_the_probe_titles_it() {
    let fixture = Uuid::new_v4();
    let (server, search) = answering(vec![
        session(Uuid::new_v4(), "Search probe notes"),
        session(fixture, &Token::random().title()),
    ])
    .await;

    let found = search
        .fixtures(EntityType::AgentSession)
        .await
        .expect("searched");

    assert_eq!(found, [EntityId(fixture)]);
    let body = sent(&server).await;
    assert_eq!(body["query"], MARKER);
    assert_eq!(body["search_on"], "name");
    assert_eq!(body["filters"]["agent_session_filters"]["include"], true);
}

#[tokio::test]
async fn a_prefix_search_asks_for_the_prefix_alone_as_a_partial_content_match() {
    let wanted = Uuid::new_v4();
    let (server, search) = answering(vec![document(wanted)]).await;

    let hits = search
        .hits(&SearchQuery::Prefix {
            entity_type: EntityType::Document,
            prefix: crate::domain::model::CrowdedPrefix::new("con").expect("a prefix"),
            entity_id: EntityId(wanted),
        })
        .await
        .expect("searched");

    assert_eq!(hits, [EntityId(wanted)]);
    let body = sent(&server).await;
    assert_eq!(body["query"], "con");
    assert_eq!(body["match_type"], "partial");
    assert_eq!(body["search_on"], "content");
    assert_eq!(
        body["filters"]["project_filters"]["project_ids"],
        json!([NIL])
    );
    // Only the probe's document is searched, so others sharing the prefix
    // cannot push it off the page.
    assert_eq!(
        body["filters"]["document_filters"]["document_ids"],
        json!([wanted.to_string()])
    );
}
