use super::*;

#[tokio::test]
async fn keeps_only_the_last_bytes() {
    let stderr: &[u8] = b"first line\nsecond line\nthird line\n";

    assert_eq!(read_tail(stderr, 11).await, b"third line\n");
    assert_eq!(read_tail(stderr, 4096).await, stderr);
}
