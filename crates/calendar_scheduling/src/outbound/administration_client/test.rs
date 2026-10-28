use super::*;

#[test]
fn requests_preserve_authenticated_actor_scope_and_wire_shape() {
    let client = SchedulingAdministrationClient::new(
        "https://calendar.example/calendar/".into(),
        "test-key".into(),
    );
    let team = Uuid::now_v7();
    let request = client
        .request(
            Method::GET,
            "/settings",
            "macro|host@example.com",
            Some(team),
        )
        .build()
        .unwrap();
    assert_eq!(request.url().path(), "/calendar/scheduling/settings");
    assert_eq!(
        request.url().query(),
        Some(format!("teamId={team}").as_str())
    );
    assert_eq!(
        request.headers()["x-internal-macro-user-id"],
        "macro|host@example.com"
    );
    assert_eq!(request.headers()["x-internal-auth-key"], "test-key");
    let change = BookingChange::Attendance {
        attendance: BookingAttendance::GuestNoShow,
    };
    assert_eq!(
        serde_json::to_value(change).unwrap(),
        serde_json::json!({"action":"attendance", "attendance":"guestNoShow"})
    );
}

#[tokio::test]
async fn stale_revision_response_remains_a_conflict() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = [0u8; 2048];
        socket.read(&mut bytes).await.unwrap();
        socket
            .write_all(b"HTTP/1.1 409 Conflict\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            .await
            .unwrap();
    });
    let client = SchedulingAdministrationClient::new(
        format!("http://{address}/calendar"),
        "test-key".into(),
    );
    assert!(matches!(
        client.settings("macro|host@example.com", None).await,
        Err(Error::Conflict)
    ));
    server.await.unwrap();
}
