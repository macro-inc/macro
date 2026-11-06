use super::*;

fn redis_client() -> redis::Client {
    let url = macro_env_var::read_env_var("REDIS_URI").unwrap();
    redis::Client::open(url).unwrap()
}

#[tokio::test]
async fn computer_account_lease_releases_when_request_is_dropped() {
    let redis = redis_client();
    let harness = HarnessId::new_from_uuid(Uuid::now_v7());
    let cleanup = TaskTracker::new();
    let background = cleanup.clone();
    let (claimed, ready) = tokio::sync::oneshot::channel();
    let request = tokio::spawn(async move {
        let _lease = AccountChange::claim(&redis, harness, &background)
            .await
            .unwrap();
        claimed.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    ready.await.unwrap();
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    cleanup.close();
    cleanup.wait().await;
    AccountChange::claim(&redis_client(), harness, &cleanup)
        .await
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[tokio::test]
async fn computer_account_lease_releases_on_failure() {
    let redis = redis_client();
    let harness = HarnessId::new_from_uuid(Uuid::now_v7());
    let cleanup = TaskTracker::new();
    let failed = async {
        let _lease = AccountChange::claim(&redis, harness, &cleanup).await?;
        Err::<(), _>(ComputerRouteError::Timeout)
    }
    .await;
    assert!(failed.is_err());
    cleanup.close();
    cleanup.wait().await;
    AccountChange::claim(&redis, harness, &cleanup)
        .await
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[tokio::test]
async fn computer_account_old_lease_cannot_release_a_new_owner() {
    let redis = redis_client();
    let harness = HarnessId::new_from_uuid(Uuid::now_v7());
    let lease = AccountChange::claim(&redis, harness, &TaskTracker::new())
        .await
        .unwrap();
    let mut connection = redis.get_multiplexed_async_connection().await.unwrap();
    connection
        .set::<_, _, ()>(&lease.key, "new-owner")
        .await
        .unwrap();
    lease.release().await.unwrap();
    assert_eq!(
        connection
            .get::<_, String>(format!("agent-harness.computer-account.{harness}"))
            .await
            .unwrap(),
        "new-owner"
    );
    connection
        .del::<_, ()>(format!("agent-harness.computer-account.{harness}"))
        .await
        .unwrap();
}

#[tokio::test]
async fn computer_dropped_sign_in_cancels_macrod_before_releasing_the_lease() {
    use agent_runtime_protocol::domain::channel::Channel;
    use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};

    let redis = redis_client();
    let harness = HarnessId::new_from_uuid(Uuid::now_v7());
    let runtimes = RuntimeRegistry::new();
    let (carrier, mut runtime) = Channel::duplex();
    runtimes.attach(harness, carrier);
    let control = ComputerControl {
        inner: Arc::new(Inner {
            runtimes,
            redis: redis.clone(),
            pending: DashMap::new(),
        }),
    };
    let cleanup = TaskTracker::new();
    let lease = AccountChange::claim(&redis, harness, &cleanup)
        .await
        .unwrap()
        .cancel_on_drop(control, harness);
    drop(lease);
    let message = tokio::time::timeout(Duration::from_secs(2), runtime.rx.recv())
        .await
        .unwrap()
        .unwrap();
    let ToRuntimeMessage::ComputerControl {
        request_id,
        command,
        ..
    } = message
    else {
        panic!("expected a computer command");
    };
    assert_eq!(command, ComputerCommand::ClaudeSignInCancel);
    // Cancellation still owns the lease until macrod confirms its terminal result.
    assert!(matches!(
        AccountChange::claim(&redis, harness, &cleanup).await,
        Err(ComputerRouteError::Conflict(_))
    ));
    runtime
        .tx
        .send(ToServerMessage::ComputerControlResponse {
            request_id,
            result: ComputerControlResult::SignInCancelled,
        })
        .unwrap();
    cleanup.close();
    cleanup.wait().await;
    AccountChange::claim(&redis, harness, &cleanup)
        .await
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[tokio::test]
async fn computer_cancel_waits_for_the_observed_lease_to_release() {
    let redis = redis_client();
    let harness = HarnessId::new_from_uuid(Uuid::now_v7());
    let lease = AccountChange::claim(&redis, harness, &TaskTracker::new())
        .await
        .unwrap();
    let released = AccountChangeRelease::watch(&redis, harness).await.unwrap();
    let (waited, released) = tokio::join!(released.wait(), lease.release());
    waited.unwrap();
    released.unwrap();
    AccountChange::claim(&redis, harness, &TaskTracker::new())
        .await
        .unwrap()
        .release()
        .await
        .unwrap();
}
