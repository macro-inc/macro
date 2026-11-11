// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values come from `testdata/media/vectors.json`, written by
//! `testdata/generator/media` running a real whatsmeow `Client.Upload`,
//! `UploadNewsletter` and `DeleteMedia` against local fake hosts.

use serde_json::Value;

use super::*;
use crate::download::download;
use crate::download::test::{FakeHosts, Recorded, hex_field, vectors};
use crate::proto::wa_e2e::ImageMessage;

/// The Go client's own user agent on uploads, which reqwest doesn't send.
fn without_user_agent(mut request: Recorded) -> Recorded {
    request.headers.remove("User-Agent");
    request
}

fn expected_requests(vector: &Value) -> Vec<Recorded> {
    vector["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(Recorded::from_vector)
        .map(without_user_agent)
        .collect()
}

#[test]
fn encryption_matches_go() {
    let vectors = vectors();
    let vector = &vectors["upload"];
    let (resp, data_to_upload) = encrypt_media(
        &hex_field(&vector["plaintext"]).unwrap(),
        &hex_field(&vector["media_key"]).unwrap(),
        MediaType::Image,
    )
    .unwrap();
    assert_eq!(
        Some(data_to_upload),
        hex_field(&vector["requests"][0]["body"])
    );
    assert_eq!(Some(resp.media_key), hex_field(&vector["media_key"]));
    assert_eq!(
        Some(resp.file_enc_sha256),
        hex_field(&vector["file_enc_sha256"])
    );
    assert_eq!(Some(resp.file_sha256), hex_field(&vector["file_sha256"]));
    assert_eq!(resp.file_length, vector["file_length"].as_u64().unwrap());
}

#[tokio::test]
async fn raw_upload_matches_go() {
    let vectors = vectors();
    let vector = &vectors["upload"];
    let hosts = FakeHosts::start(
        vec![Vec::new(), Vec::new()],
        vectors["auth"].as_str().unwrap(),
    )
    .await;
    hosts.set_upload_answer(vector["response_json"].as_str().unwrap());
    let (mut resp, data_to_upload) = encrypt_media(
        &hex_field(&vector["plaintext"]).unwrap(),
        &hex_field(&vector["media_key"]).unwrap(),
        MediaType::Image,
    )
    .unwrap();
    let file_enc_sha256 = resp.file_enc_sha256.clone();

    raw_upload(
        &FakeHosts::http(),
        &hosts.media_conn,
        data_to_upload,
        &file_enc_sha256,
        MediaType::Image,
        false,
        &mut resp,
    )
    .await
    .unwrap();

    assert_eq!(hosts.take_requests(), expected_requests(vector));
    assert_eq!(resp.url, vector["url"].as_str().unwrap());
    assert_eq!(resp.direct_path, vector["direct_path"].as_str().unwrap());
    assert_eq!(resp.handle, vector["handle"].as_str().unwrap());
    assert_eq!(resp.object_id, vector["object_id"].as_str().unwrap());
}

#[tokio::test]
async fn newsletter_upload_matches_go() {
    let vectors = vectors();
    let vector = &vectors["upload_newsletter"];
    let hosts = FakeHosts::start(vec![Vec::new()], vectors["auth"].as_str().unwrap()).await;
    hosts.set_upload_answer(vector["response_json"].as_str().unwrap());

    let resp = upload_newsletter(
        &FakeHosts::http(),
        &hosts.media_conn,
        &hex_field(&vector["plaintext"]).unwrap(),
        MediaType::Video,
    )
    .await
    .unwrap();

    assert_eq!(hosts.take_requests(), expected_requests(vector));
    assert_eq!(
        resp,
        UploadResponse {
            url: vector["url"].as_str().unwrap().to_owned(),
            direct_path: vector["direct_path"].as_str().unwrap().to_owned(),
            handle: vector["handle"].as_str().unwrap().to_owned(),
            object_id: vector["object_id"].as_str().unwrap().to_owned(),
            media_key: Vec::new(),
            file_enc_sha256: Vec::new(),
            file_sha256: hex_field(&vector["file_sha256"]).unwrap(),
            file_length: vector["file_length"].as_u64().unwrap(),
        }
    );
}

#[tokio::test]
async fn delete_media_matches_go() {
    let vectors = vectors();
    let vector = &vectors["delete"];
    let hosts = FakeHosts::start(vec![Vec::new()], vectors["auth"].as_str().unwrap()).await;

    delete_media(
        &FakeHosts::http(),
        &hosts.media_conn,
        MediaType::History,
        vector["direct_path"].as_str().unwrap(),
        &hex_field(&vector["enc_file_hash"]).unwrap(),
        vector["enc_handle"].as_str().unwrap(),
        vector["companion_meta_nonce"].as_str().unwrap(),
    )
    .await
    .unwrap();

    assert_eq!(hosts.take_requests(), expected_requests(vector));
}

#[tokio::test]
async fn upload_then_download_round_trips() {
    let hosts = FakeHosts::start(vec![Vec::new()], "auth").await;
    hosts.set_upload_answer(
        r#"{"url":"https://example.invalid/u","direct_path":"/v/t62/u.enc?ccb=1"}"#,
    );
    let http = FakeHosts::http();
    let plaintext = b"round trip through the fake media host".repeat(40);

    let resp = upload(&http, &hosts.media_conn, &plaintext, MediaType::Image)
        .await
        .unwrap();
    assert_eq!(resp.direct_path, "/v/t62/u.enc?ccb=1");
    assert_eq!(resp.media_key.len(), 32);

    let message = ImageMessage {
        url: Some(resp.url),
        direct_path: Some(resp.direct_path),
        media_key: Some(resp.media_key),
        file_enc_sha256: Some(resp.file_enc_sha256),
        file_sha256: Some(resp.file_sha256),
        file_length: Some(resp.file_length),
        ..ImageMessage::default()
    };
    assert_eq!(
        download(&http, &hosts.media_conn, &message).await.unwrap(),
        plaintext
    );
    let methods: Vec<String> = hosts
        .take_requests()
        .into_iter()
        .map(|request| request.method)
        .collect();
    assert_eq!(methods, ["POST", "GET"]);
}

#[tokio::test]
async fn upload_failures() {
    let hosts = FakeHosts::start(Vec::new(), "auth").await;
    let http = FakeHosts::http();
    assert!(matches!(
        upload(&http, &hosts.media_conn, b"x", MediaType::Image).await,
        Err(UploadError::NoHosts)
    ));

    let hosts = FakeHosts::start(
        vec![vec![crate::download::test::Answer {
            status: 500,
            retry_after: None,
            body: Some(Vec::new()),
        }]],
        "auth",
    )
    .await;
    assert_eq!(
        upload(&http, &hosts.media_conn, b"x", MediaType::Image)
            .await
            .unwrap_err()
            .to_string(),
        "upload failed with status code 500"
    );
}

#[test]
fn query_escape_like_go() {
    assert_eq!(
        query_escape("AUTH token/with+odd=chars~*!"),
        "AUTH+token%2Fwith%2Bodd%3Dchars~%2A%21"
    );
    assert_eq!(
        encode_query(&[("token", "t"), ("auth", "a b")]),
        "auth=a+b&token=t"
    );
}

#[tokio::test]
async fn the_client_sends_media_to_the_configured_base_url() {
    use crate::client::test::{children, connect_paired, harness_with, next_node, node, text};
    use crate::testing::is_iq;

    let hosts = FakeHosts::start(vec![Vec::new()], "auth").await;
    hosts.set_upload_answer(
        r#"{"url":"https://example.invalid/u","direct_path":"/v/t62/c.enc?ccb=1"}"#,
    );
    let base_url = format!("http://{}", hosts.media_conn.hosts[0].hostname);
    let mut harness = harness_with(Some(("1234:5@s.whatsapp.net", "9876:5@lid")), |config| {
        config.media_base_url = Some(base_url);
    });
    let mut connection = connect_paired(&mut harness).await;

    let client = std::sync::Arc::clone(&harness.client);
    let plaintext = b"media through the override".repeat(20);
    let upload_plaintext = plaintext.clone();
    let upload =
        tokio::spawn(async move { client.upload(&upload_plaintext, MediaType::Image).await });
    let media_conn = next_node(&mut connection).await;
    assert!(is_iq(&media_conn, "w:m"));
    // The server names WhatsApp's real host; the override wins.
    connection
        .respond_iq(
            &media_conn,
            vec![node(
                "media_conn",
                &[
                    ("auth", text("auth")),
                    ("ttl", text("300")),
                    ("auth_ttl", text("60")),
                    ("max_buckets", text("1")),
                ],
                children(vec![node(
                    "host",
                    &[("hostname", text("mmg.whatsapp.net"))],
                    None,
                )]),
            )],
        )
        .await;
    let response = upload.await.unwrap().unwrap();
    let message = ImageMessage {
        direct_path: Some(response.direct_path),
        media_key: Some(response.media_key),
        file_enc_sha256: Some(response.file_enc_sha256),
        file_sha256: Some(response.file_sha256),
        file_length: Some(response.file_length),
        ..ImageMessage::default()
    };
    assert_eq!(harness.client.download(&message).await.unwrap(), plaintext);
    let methods: Vec<String> = hosts
        .take_requests()
        .into_iter()
        .map(|request| request.method)
        .collect();
    assert_eq!(methods, ["POST", "GET"]);
}
