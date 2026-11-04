use sqlx::postgres::PgPoolOptions;

use super::*;

async fn open_transaction(options: &PgConnectOptions, application_name: &str) -> PgConnection {
    let mut connection = options
        .clone()
        .application_name(application_name)
        .connect()
        .await
        .unwrap();
    sqlx::raw_sql("BEGIN; SELECT 1")
        .execute(&mut connection)
        .await
        .unwrap();
    connection
}

#[sqlx::test(migrations = false)]
async fn reports_open_transactions_with_their_application_name(
    _: PgPoolOptions,
    options: PgConnectOptions,
) {
    let _holder = open_transaction(&options, "holder_service").await;
    let mut source = PgActivitySource::new(options.application_name("sampler"));

    let Sample::Sessions(sessions) = source.long_transactions(Duration::ZERO).await.unwrap() else {
        panic!("the only sampler should lead");
    };

    assert_eq!(sessions.len(), 1, "{sessions:?}");
    let session = &sessions[0];
    assert_eq!(session.application_name, "holder_service");
    assert_eq!(session.state.as_deref(), Some("idle in transaction"));
    assert_eq!(session.query.as_deref(), Some("BEGIN; SELECT 1"));
}

#[sqlx::test(migrations = false)]
async fn skips_transactions_younger_than_the_threshold(
    _: PgPoolOptions,
    options: PgConnectOptions,
) {
    let _holder = open_transaction(&options, "holder_service").await;
    let mut source = PgActivitySource::new(options);

    let sample = source
        .long_transactions(Duration::from_secs(3600))
        .await
        .unwrap();

    assert_eq!(sample, Sample::Sessions(vec![]));
}

#[sqlx::test(migrations = false)]
async fn one_replica_samples_and_another_takes_over_when_it_stops(
    _: PgPoolOptions,
    options: PgConnectOptions,
) {
    let mut first = PgActivitySource::new(options.clone());
    let mut second = PgActivitySource::new(options);

    assert!(matches!(
        first.long_transactions(Duration::ZERO).await.unwrap(),
        Sample::Sessions(_)
    ));
    assert_eq!(
        second.long_transactions(Duration::ZERO).await.unwrap(),
        Sample::NotLeader
    );
    assert!(matches!(
        first.long_transactions(Duration::ZERO).await.unwrap(),
        Sample::Sessions(_)
    ));

    first.leader.take().unwrap().close().await.unwrap();

    assert!(matches!(
        second.long_transactions(Duration::ZERO).await.unwrap(),
        Sample::Sessions(_)
    ));
}
