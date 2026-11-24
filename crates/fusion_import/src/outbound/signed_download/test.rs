use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn signed(server: &MockServer, paths: &[&str]) -> SignedUrl {
    SignedUrl {
        parts: paths
            .iter()
            .map(|part| format!("{}{part}", server.uri()))
            .collect(),
        size: None,
    }
}

#[tokio::test]
async fn the_parts_come_back_joined_in_order() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/chunk-0"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"solid ".to_vec()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/chunk-1"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"part".to_vec()))
        .mount(&server)
        .await;
    let downloads = HttpSignedDownloads::allowing_plain_http().unwrap();

    let download = downloads
        .fetch(&signed(&server, &["/chunk-0", "/chunk-1"]), 1024)
        .await
        .unwrap();

    assert_eq!(download, Download::Bytes(Bytes::from_static(b"solid part")));
}

#[tokio::test]
async fn a_body_past_the_cap_is_too_large() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/model.stl"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![7_u8; 2048]))
        .mount(&server)
        .await;
    let downloads = HttpSignedDownloads::allowing_plain_http().unwrap();

    let download = downloads
        .fetch(&signed(&server, &["/model.stl"]), 2047)
        .await
        .unwrap();

    assert_eq!(download, Download::TooLarge);
}

#[tokio::test]
async fn the_cap_counts_every_part_together() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![1_u8; 600]))
        .mount(&server)
        .await;
    let downloads = HttpSignedDownloads::allowing_plain_http().unwrap();

    let at_cap = downloads
        .fetch(&signed(&server, &["/a", "/b"]), 1200)
        .await
        .unwrap();
    let past_cap = downloads
        .fetch(&signed(&server, &["/a", "/b"]), 1199)
        .await
        .unwrap();

    assert!(matches!(at_cap, Download::Bytes(bytes) if bytes.len() == 1200));
    assert_eq!(past_cap, Download::TooLarge);
}

#[tokio::test]
async fn a_refusal_is_typed_with_its_status() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let downloads = HttpSignedDownloads::allowing_plain_http().unwrap();

    let error = downloads
        .fetch(&signed(&server, &["/expired"]), 1024)
        .await
        .unwrap_err();

    assert!(matches!(error, DownloadError::Status(403)));
}

#[tokio::test]
async fn a_redirect_is_not_followed() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/moved"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/elsewhere"))
        .mount(&server)
        .await;
    let downloads = HttpSignedDownloads::allowing_plain_http().unwrap();

    let error = downloads
        .fetch(&signed(&server, &["/moved"]), 1024)
        .await
        .unwrap_err();

    assert!(matches!(error, DownloadError::Status(302)));
}

#[tokio::test]
async fn only_https_addresses_are_fetched() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"bytes".to_vec()))
        .expect(0)
        .mount(&server)
        .await;
    let downloads = HttpSignedDownloads::new().unwrap();

    let error = downloads
        .fetch(&signed(&server, &["/model.stl"]), 1024)
        .await
        .unwrap_err();

    assert!(matches!(error, DownloadError::Internal(_)));
}

/// A server answering every connection with a 1024-byte body in chunked
/// encoding, so the response carries no length to check up front.
async fn chunked_server() -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            // A client that stops reading at its cap closes the connection;
            // that ends this answer, not the server.
            let _ = async {
                // Read the request head, then answer.
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let read = socket.read(&mut buffer).await?;
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                }
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n")
                    .await?;
                for _ in 0..4 {
                    socket.write_all(b"100\r\n").await?;
                    socket.write_all(&[9_u8; 256]).await?;
                    socket.write_all(b"\r\n").await?;
                }
                socket.write_all(b"0\r\n\r\n").await
            }
            .await;
        }
    });
    format!("http://{address}/model.stl")
}

#[tokio::test]
async fn a_body_with_no_length_is_cut_off_mid_stream_at_the_cap() {
    let address = chunked_server().await;
    let downloads = HttpSignedDownloads::allowing_plain_http().unwrap();
    let url = SignedUrl {
        parts: vec![address],
        size: None,
    };

    let past_cap = downloads.fetch(&url, 1000).await.unwrap();
    let at_cap = downloads.fetch(&url, 1024).await.unwrap();

    assert_eq!(past_cap, Download::TooLarge);
    assert!(matches!(at_cap, Download::Bytes(bytes) if bytes.len() == 1024));
}
