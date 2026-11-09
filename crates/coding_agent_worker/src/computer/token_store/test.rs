use super::*;
use std::os::unix::fs::MetadataExt as _;

#[tokio::test]
async fn private_store_loads_saves_and_deletes_through_the_socket() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("claude-token");
    for (request, expected) in [
        (Request::Load, "loaded"),
        (
            Request::Save {
                token: "private-token".to_owned(),
            },
            "saved",
        ),
        (Request::Load, "loaded"),
        (Request::Delete, "deleted"),
        (Request::Delete, "deleted"),
    ] {
        let (mut client, mut server) = UnixStream::pair().unwrap();
        let service = serve(&mut server, &path);
        let exchange = async {
            write_frame(&mut client, &request).await.unwrap();
            let reply: Reply = read_frame(&mut client).await.unwrap();
            let json = serde_json::to_value(&reply).unwrap();
            assert_eq!(json["status"], expected);
            if matches!(&request, Request::Load) {
                let token = if path.exists() {
                    serde_json::json!("private-token")
                } else {
                    serde_json::Value::Null
                };
                assert_eq!(json["token"], token);
            }
            if matches!(&request, Request::Save { .. }) {
                let metadata = std::fs::metadata(&path).unwrap();
                assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
                assert_eq!(metadata.uid(), rustix::process::geteuid().as_raw());
            }
        };
        let (served, ()) = tokio::join!(service, exchange);
        served.unwrap();
    }
    assert!(!path.exists());
}

#[tokio::test]
async fn oversized_store_requests_fail_without_creating_a_token() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("claude-token");
    let (mut client, mut server) = UnixStream::pair().unwrap();
    let service = serve(&mut server, &path);
    let oversized = async {
        client
            .write_all(&vec![b'x'; MAX_FRAME as usize + 1])
            .await
            .unwrap();
    };
    let (served, ()) = tokio::join!(service, oversized);
    assert!(served.is_err());
    assert!(!path.exists());
}
