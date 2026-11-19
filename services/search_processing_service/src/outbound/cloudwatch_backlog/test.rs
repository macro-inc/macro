use super::*;

#[test]
fn each_lane_is_one_datum_in_seconds_with_its_environment() {
    let data = datums(
        LaneBacklog {
            live: Some(Duration::from_millis(1_500)),
            email: Some(Duration::from_secs(7_200)),
        },
        "prod",
    );

    let read: Vec<_> = data
        .iter()
        .map(|datum| {
            (
                datum.metric_name().map(str::to_owned),
                datum
                    .dimensions()
                    .iter()
                    .map(|dimension| {
                        format!(
                            "{}={}",
                            dimension.name().unwrap_or_default(),
                            dimension.value().unwrap_or_default()
                        )
                    })
                    .collect::<Vec<_>>(),
                datum.value(),
                datum.unit().cloned(),
            )
        })
        .collect();
    assert_eq!(
        read,
        [
            (
                Some(OLDEST_PENDING.to_owned()),
                vec!["Environment=prod".to_owned(), "Lane=live".to_owned()],
                Some(1.5),
                Some(StandardUnit::Seconds),
            ),
            (
                Some(OLDEST_PENDING.to_owned()),
                vec!["Environment=prod".to_owned(), "Lane=email".to_owned()],
                Some(7_200.0),
                Some(StandardUnit::Seconds),
            ),
        ]
    );
}

#[tokio::test]
async fn a_local_service_only_logs_its_readings() {
    let sink = CloudWatchBacklog::LogOnly;

    sink.publish(LaneBacklog {
        live: Some(Duration::ZERO),
        email: None,
    })
    .await
    .expect("logging cannot fail");
}

#[test]
fn a_lane_the_task_owns_no_partition_in_is_left_out() {
    let data = datums(
        LaneBacklog {
            live: Some(Duration::ZERO),
            email: None,
        },
        "dev",
    );

    let lanes: Vec<_> = data
        .iter()
        .flat_map(|datum| datum.dimensions())
        .filter(|dimension| dimension.name() == Some(LANE_DIMENSION))
        .filter_map(|dimension| dimension.value())
        .collect();
    assert_eq!(lanes, ["live"]);
}
