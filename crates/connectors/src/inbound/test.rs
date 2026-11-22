use super::*;
use crate::domain::models::ConnectorId;
use crate::inbound::test_support::user;
use std::sync::Mutex;

/// A hook that records each change it is given under `name`.
fn recording(
    name: &'static str,
    log: &Arc<Mutex<Vec<(&'static str, ConnectorKey)>>>,
) -> ConnectorHook {
    let log = log.clone();
    Arc::new(move |change: ConnectorChange| {
        log.lock().unwrap().push((name, change.key));
        Box::pin(async {})
    })
}

#[tokio::test]
async fn each_of_runs_every_hook_in_turn() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let hook = each_of(vec![recording("first", &log), recording("second", &log)]);
    let key = ConnectorKey::App(ConnectorId::parse("granola").unwrap());

    fire(Some(&hook), &user("owner"), std::slice::from_ref(&key)).await;

    assert_eq!(
        *log.lock().unwrap(),
        vec![("first", key.clone()), ("second", key)]
    );
}
