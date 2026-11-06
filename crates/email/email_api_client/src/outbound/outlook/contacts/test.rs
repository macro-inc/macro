use super::*;
use crate::outbound::outlook::test::setup;
use serde_json::json;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

#[tokio::test]
async fn discovers_the_default_folder_from_a_contact_and_recurses_children() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/contactFolders"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[]})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/contacts"))
        .and(query_param("$top", "1"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"person","parentFolderId":"root"}]})),
        )
        .mount(&server)
        .await;
    let catalog = api.contact_folders(&token).await.unwrap();
    assert_eq!(catalog.default_folder.unwrap().as_str(), "root");
    assert_eq!(catalog.folders.len(), 1);

    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/contactFolders"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"child","parentFolderId":"root"}]})),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/contactFolders/child/childFolders"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"grandchild","parentFolderId":"child"}]})),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/contactFolders/grandchild/childFolders"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[]})))
        .mount(&server)
        .await;
    let catalog = api.contact_folders(&token).await.unwrap();
    assert_eq!(
        catalog
            .folders
            .iter()
            .map(ProviderId::as_str)
            .collect::<Vec<_>>(),
        vec!["child", "grandchild", "root"]
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn contact_delta_preserves_all_addresses_and_deletion_and_opaque_cursor() {
    let (server, api, token) = setup().await;
    let next = format!(
        "{}/v1.0/me/contactFolders/root/contacts/delta?$deltatoken=opaque%2F%3D",
        server.uri()
    );
    Mock::given(method("GET")).and(path("/v1.0/me/contactFolders/root/contacts/delta"))
        .and(header("authorization","Bearer test-bearer"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[
            {"id":"one","displayName":"Friend","emailAddresses":[{"address":"A@Example.com"},{"address":"b@example.com"},{"address":"a@example.com"}]},
            {"id":"gone","@removed":{"reason":"deleted"}}
        ],"@odata.deltaLink":next}))).mount(&server).await;
    let page = api
        .contact_changes(&token, &ProviderId::new("root").unwrap(), None)
        .await
        .unwrap();
    assert_eq!(
        page.contacts[0].emails,
        vec!["a@example.com", "b@example.com"]
    );
    assert_eq!(page.removed[0].as_str(), "gone");
    assert_eq!(
        page.position,
        StreamPosition::Checkpoint(StreamToken::new(next))
    );
}

#[tokio::test]
async fn photos_require_the_mailbox_bearer_and_reject_active_content() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/photo/$value"))
        .and(header("authorization", "Bearer test-bearer"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(b"<svg></svg>")
                .insert_header("content-type", "image/svg+xml"),
        )
        .mount(&server)
        .await;
    assert!(api.contact_photo(&token, None).await.is_err());
    server.reset().await;
    Mock::given(method("GET"))
        .and(path(
            "/v1.0/me/contactFolders/root/contacts/person/photo/$value",
        ))
        .and(header("authorization", "Bearer test-bearer"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    assert!(
        api.contact_photo(
            &token,
            Some((
                &ProviderId::new("root").unwrap(),
                &ProviderId::new("person").unwrap()
            ))
        )
        .await
        .unwrap()
        .is_none()
    );
}
