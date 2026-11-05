use super::*;

#[tokio::test]
async fn a_listening_display_port_counts_as_a_screen() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    assert!(listening(&address).await);
    drop(listener);
    assert!(!listening(&address).await);
}
