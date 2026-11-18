use super::*;

#[tokio::test]
async fn observe_source_ids_reports_the_largest_list_a_check_bound() {
    let ((), seen) = observe_source_ids(async {
        record_source_ids(3);
        record_source_ids(1_003);
        record_source_ids(2);
    })
    .await;

    assert_eq!(seen, Some(1_003));
}

#[tokio::test]
async fn observe_source_ids_reports_none_without_a_check() {
    let ((), seen) = observe_source_ids(async {}).await;

    assert_eq!(seen, None);
}

#[tokio::test]
async fn record_source_ids_outside_an_observation_does_nothing() {
    record_source_ids(5);

    let ((), seen) = observe_source_ids(async {}).await;
    assert_eq!(seen, None);
}
