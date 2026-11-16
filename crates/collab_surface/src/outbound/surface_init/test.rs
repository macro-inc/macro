use reqwest::StatusCode;
use sync_service_client::document_state::DocumentStateError;

use super::*;

#[tokio::test]
async fn retrying_a_created_session_keeps_it_and_finishes_without_another_request() {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
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
    let url = format!("http://{address}");
    let initializer = LexicalSyncSurfaceInitializer::new(
        LexicalClient::new("local-test-key".to_string(), url.clone()),
        SyncServiceClient::new("local-test-key".to_string(), url),
    );

    initializer
        .initialize_from_snapshot("form-layout", &[1, 2, 3])
        .await
        .unwrap();
    server.join().unwrap();
}

#[test]
fn sync_service_refusals_map_to_surface_errors() {
    assert!(matches!(
        surface_state_error(DocumentStateError::NotFound),
        CollabSurfaceError::NotFound
    ));
    assert!(matches!(
        surface_state_error(DocumentStateError::TooLarge),
        CollabSurfaceError::BadRequest(_)
    ));
    assert!(matches!(
        surface_state_error(DocumentStateError::Invalid),
        CollabSurfaceError::BadRequest(_)
    ));
    assert!(matches!(
        surface_state_error(DocumentStateError::Forbidden),
        CollabSurfaceError::AccessDenied
    ));
    // Our own grant was refused: a configuration fault, not the caller's.
    assert!(matches!(
        surface_state_error(DocumentStateError::Unauthorized),
        CollabSurfaceError::Internal(_)
    ));
    assert!(matches!(
        surface_state_error(DocumentStateError::Rejected(
            StatusCode::SERVICE_UNAVAILABLE
        )),
        CollabSurfaceError::Internal(_)
    ));
    assert!(matches!(
        surface_state_error(DocumentStateError::InvalidResponse("missing revision")),
        CollabSurfaceError::Internal(_)
    ));
}

#[test]
fn a_sync_service_conflict_is_a_surface_conflict() {
    assert_eq!(
        surface_update(DocumentUpdate::Conflict),
        SurfaceUpdate::Conflict
    );
    assert_eq!(
        surface_update(DocumentUpdate::Applied {
            revision: vec![1, 3]
        }),
        SurfaceUpdate::Applied {
            revision: vec![1, 3]
        }
    );
}
