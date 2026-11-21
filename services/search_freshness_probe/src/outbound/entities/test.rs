use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

/// The share settings that leave an entity to its owner alone.
static PRIVATE: std::sync::LazyLock<serde_json::Value> = std::sync::LazyLock::new(
    || json!({"linkShare": null, "teamShareAccessLevel": null, "channelSharePermissions": null}),
);

async fn server() -> (MockServer, MacroApi) {
    let server = MockServer::start().await;
    let api = MacroApi::new(&server.uri(), "mak_key").expect("a valid key");
    (server, api)
}

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

#[tokio::test]
async fn a_document_is_created_with_its_title_and_body_tokens() {
    let (server, api) = server().await;
    let title = Token::random();
    let body = Token::random();
    Mock::given(method("POST"))
        .and(path("/dss/documents/create_markdown"))
        .and(body_json(json!({
            "documentName": format!("Search probe {}", title.as_str()),
            "markdown": body.as_str(),
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "documentId": id(1),
            "documentMetadata": {},
            "token": "t",
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path(format!("/dss/documents/{}", id(1))))
        .and(body_json(json!({"sharePermission": PRIVATE.clone()})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let created = Documents::new(api)
        .create(&[(TitleOrBody::Body, body), (TitleOrBody::Title, title)])
        .await
        .expect("created");

    assert_eq!(created, EntityId(id(1)));
}

#[tokio::test]
async fn a_document_that_cannot_be_made_private_is_deleted_and_fails_the_create() {
    let (server, api) = server().await;
    Mock::given(method("POST"))
        .and(path("/dss/documents/create_markdown"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "documentId": id(1),
            "documentMetadata": {},
            "token": "t",
        })))
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path(format!("/dss/documents/{}", id(1))))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/documents/{}/permanent", id(1))))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let created = Documents::new(api)
        .create(&[(TitleOrBody::Title, Token::random())])
        .await;

    assert!(created.is_err());
}

#[tokio::test]
async fn a_document_body_is_replaced_at_its_current_revision() {
    let (server, api) = server().await;
    let token = Token::random();
    Mock::given(method("GET"))
        .and(path(format!("/dss/documents/{}/markdown", id(1))))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"markdown": "old", "revision": "r7"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path(format!("/dss/documents/{}/markdown", id(1))))
        .and(body_json(
            json!({"markdown": token.as_str(), "expectedRevision": "r7"}),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"revision": "r8", "changed": true})),
        )
        .expect(1)
        .mount(&server)
        .await;

    Documents::new(api)
        .set(EntityId(id(1)), TitleOrBody::Body, &token)
        .await
        .expect("replaced");
}

#[tokio::test]
async fn a_document_is_renamed_and_purged_and_one_already_gone_counts_as_purged() {
    let (server, api) = server().await;
    let token = Token::random();
    Mock::given(method("PATCH"))
        .and(path(format!("/dss/documents/{}", id(1))))
        .and(body_json(json!({"documentName": token.title()})))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/documents/{}/permanent", id(1))))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;
    let mut documents = Documents::new(api);

    documents
        .set(EntityId(id(1)), TitleOrBody::Title, &token)
        .await
        .expect("renamed");
    documents.delete(EntityId(id(1))).await.expect("gone");
}

#[tokio::test]
async fn messages_go_to_one_private_channel_of_the_probes_own_deleted_at_shutdown() {
    let (server, api) = server().await;
    Mock::given(method("POST"))
        .and(path("/dss/channels"))
        .and(body_json(json!({
            "name": "Search probe",
            "channel_type": "private",
            "team_id": null,
            "auto_join_team": false,
            "participants": [],
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": id(9)})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/dss/messages/channel/{}", id(9))))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": id(2)})))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path(format!(
            "/dss/messages/channel/{}/items/{}",
            id(9),
            id(2)
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": id(2)})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!(
            "/dss/messages/channel/{}/items/{}",
            id(9),
            id(2)
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": id(2)})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/channels/{}", id(9))))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let mut messages = Messages::new(api);

    let posted = messages
        .create(&[(Body, Token::random())])
        .await
        .expect("posted");
    messages
        .set(posted, Body, &Token::random())
        .await
        .expect("edited");
    messages.delete(posted).await.expect("deleted");
    messages
        .create(&[(Body, Token::random())])
        .await
        .expect("posted again in the same channel");
    messages.close().await;

    assert_eq!(posted, EntityId(id(2)));
}

#[tokio::test]
async fn a_project_is_created_renamed_and_purged() {
    let (server, api) = server().await;
    let title = Token::random();
    let renamed = Token::random();
    Mock::given(method("POST"))
        .and(path("/dss/projects"))
        .and(body_json(
            json!({"name": title.title(), "projectParentId": null}),
        ))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"data": {"id": id(4)}, "error": false})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path(format!("/dss/v2/projects/{}", id(4))))
        .respond_with(ResponseTemplate::new(200))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/projects/{}", id(4))))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/projects/{}/permanent", id(4))))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let mut projects = Projects::new(api);

    let project = projects.create(&[(Title, title)]).await.expect("created");
    projects
        .set(project, Title, &renamed)
        .await
        .expect("renamed");
    projects.delete(project).await.expect("purged");

    let requests = server.received_requests().await.expect("recorded");
    let share: serde_json::Value = requests[1].body_json().expect("a JSON body");
    assert_eq!(share["sharePermission"], *PRIVATE);
    assert_eq!(share["name"], serde_json::Value::Null);
    let rename: serde_json::Value = requests[2].body_json().expect("a JSON body");
    assert_eq!(rename["name"], renamed.title());
    // The purge route skips a project not in the trash, so it is trashed
    // first.
    let deletes: Vec<_> = requests[3..]
        .iter()
        .map(|request| request.url.path().to_owned())
        .collect();
    assert_eq!(
        deletes,
        [
            format!("/dss/projects/{}", id(4)),
            format!("/dss/projects/{}/permanent", id(4)),
        ]
    );
}

#[tokio::test]
async fn a_document_that_could_not_be_made_private_or_deleted_is_deleted_at_shutdown() {
    let (server, api) = server().await;
    Mock::given(method("POST"))
        .and(path("/dss/documents/create_markdown"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "documentId": id(1),
            "documentMetadata": {},
            "token": "t",
        })))
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    // The first delete fails; the retry at shutdown succeeds.
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/documents/{}/permanent", id(1))))
        .respond_with(ResponseTemplate::new(500))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/dss/documents/{}/permanent", id(1))))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let mut documents = Documents::new(api);

    let created = documents
        .create(&[(TitleOrBody::Title, Token::random())])
        .await;
    documents.close().await;

    assert!(created.is_err());
}
