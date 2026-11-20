use email::domain::mailbox::inbox_sync::build_notification_recipients;
use macro_user_id::user_id::MacroUserIdStr;

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).expect("valid macro user id")
}

#[test]
fn fans_out_to_owner_and_every_delegated_primary() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "macro|alice@team.test".to_string(),
        "macro|bob@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 3);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|alice@team.test")));
    assert!(recipients.contains(&id("macro|bob@team.test")));
}

#[test]
fn owner_only_when_no_delegates() {
    let owner = id("macro|solo@personal.test");
    let recipients = build_notification_recipients(&owner, vec![]);
    assert_eq!(recipients.len(), 1);
    assert!(recipients.contains(&owner));
}

#[test]
fn skips_primaries_that_fail_to_parse() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "not-a-macro-id".to_string(),
        "macro|ok@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 2);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|ok@team.test")));
}

#[tokio::test(start_paused = true)]
async fn work_runs_on_while_a_heartbeat_hangs() {
    let start = tokio::time::Instant::now();
    let work = async {
        tokio::time::sleep(std::time::Duration::from_secs(25)).await;
        "done"
    };

    let output = super::run_hidden(work, std::future::pending::<anyhow::Result<()>>).await;

    assert_eq!(output, "done");
    assert_eq!(start.elapsed(), std::time::Duration::from_secs(25));
}

#[tokio::test(start_paused = true)]
async fn a_heartbeat_that_never_answers_does_not_hold_the_next_one() {
    let mut heartbeats = 0;
    let work = tokio::time::sleep(std::time::Duration::from_secs(70));

    super::run_hidden(work, || {
        heartbeats += 1;
        std::future::pending::<anyhow::Result<()>>()
    })
    .await;

    // One every 20 s: 20, 40 and 60 s in.
    assert_eq!(heartbeats, 3);
}
