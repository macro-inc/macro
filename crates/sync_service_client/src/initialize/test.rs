use std::io::{Read, Write};

use super::{SnapshotAlreadyExists, SyncServiceClient, encode_initialize_from_snapshot_request};

#[test]
fn test_encode_initialize_from_snapshot_request() {
    let encoded = encode_initialize_from_snapshot_request(&[1, 2, 3]).unwrap();
    assert_eq!(encoded, vec![3, 0, 0, 0, 1, 2, 3]);
}

#[tokio::test]
async fn existing_snapshot_is_a_typed_conflict() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let mut body = [0; 7];
        stream.read_exact(&mut body).unwrap();
        assert_eq!(body, [3, 0, 0, 0, 1, 2, 3]);
        stream
            .write_all(b"HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let client = SyncServiceClient::new("local-test-key".to_string(), format!("http://{address}"));
    let error = client
        .initialize_from_snapshot("form-layout", &[1, 2, 3])
        .await
        .unwrap_err();
    server.join().unwrap();
    assert!(error.is::<SnapshotAlreadyExists>());
}
