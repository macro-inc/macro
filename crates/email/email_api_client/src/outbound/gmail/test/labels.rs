use uuid::Uuid;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, ResponseTemplate};

use super::repository;
use crate::domain::models::AccessToken;
use crate::domain::ports::MailboxLabelClient;

#[tokio::test]
async fn lists_and_creates_normalized_labels() {
    let (server, repository) = repository().await;
    Mock::given(method("GET"))
        .and(path("/users/me/labels"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(include_str!("fixtures/labels.json"), "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/users/me/labels"))
        .and(body_json(serde_json::json!({
            "id": null,
            "name": "Projects",
            "messageListVisibility": "show",
            "labelListVisibility": "labelShow",
            "type": "user",
            "color": null
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "Label_1", "name": "Projects", "type": "user"
        })))
        .mount(&server)
        .await;

    let link_id = Uuid::now_v7();
    let labels = repository
        .list_labels(&AccessToken::new("token"), link_id)
        .await
        .unwrap();
    assert_eq!(labels.len(), 2);
    assert!(labels.iter().all(|label| label.link_id == link_id));

    let created = repository
        .create_label(&AccessToken::new("token"), link_id, "Projects")
        .await
        .unwrap();
    assert_eq!(created.provider_label_id, "Label_1");
}

#[tokio::test]
async fn deletion_is_idempotent_when_a_label_races_deletion() {
    let (server, repository) = repository().await;
    Mock::given(method("DELETE"))
        .and(path("/users/me/labels/deleted"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    repository
        .delete_label(&AccessToken::new("token"), "deleted")
        .await
        .unwrap();
}
