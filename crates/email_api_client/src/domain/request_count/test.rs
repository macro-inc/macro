use super::{counted, record_sent};

#[tokio::test]
async fn counts_only_requests_inside_the_scope() {
    record_sent();
    let ((), outer) = counted(async {
        record_sent();
        let ((), inner) = counted(async {
            record_sent();
            record_sent();
        })
        .await;
        assert_eq!(inner, 2);
        record_sent();
    })
    .await;
    assert_eq!(outer, 2);
}
