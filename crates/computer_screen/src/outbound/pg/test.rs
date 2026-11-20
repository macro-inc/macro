use std::time::Duration;

use chrono::Utc;
use computer_id::ComputerId;
use harness_id::HarnessId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgScreenRepo;
use crate::domain::models::{
    Driver, EndReason, Mode, NoticeName, Release, ScreenGrant, SessionId, Surface, TakeOver,
    Transport,
};
use crate::domain::ports::ScreenRepo;

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(0xC0));
const TWO_MINUTES: Duration = Duration::from_secs(120);

fn grant(user: &str, mode: Mode) -> ScreenGrant {
    ScreenGrant {
        harness_id: HarnessId::TEST_A,
        computer_id: COMPUTER,
        agent_user_id: Some(
            MacroUserIdStr::try_from("macro|scout@example.com".to_owned()).unwrap(),
        ),
        user_id: MacroUserIdStr::try_from(format!("macro|{user}@example.com")).unwrap(),
        transport: Transport::Vnc,
        surface: Surface::Desktop,
        mode,
    }
}

async fn session(repo: &PgScreenRepo, grant: &ScreenGrant) -> SessionId {
    let id = SessionId::new();
    repo.start_session(id, grant).await.unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_ticket_works_once(pool: PgPool) {
    let repo = PgScreenRepo::new(pool);
    let alice = grant("alice", Mode::Drive);
    let hash = [7u8; 32];
    repo.insert_ticket(
        hash,
        &alice,
        Some("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"),
        Utc::now() + Duration::from_secs(60),
    )
    .await
    .unwrap();

    let redeemed = repo.redeem_ticket(hash).await.unwrap().unwrap();
    assert_eq!(redeemed.grant, alice);
    assert_eq!(
        redeemed.traceparent.as_deref(),
        Some("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
    );
    assert_eq!(repo.redeem_ticket(hash).await.unwrap(), None);
    assert_eq!(repo.redeem_ticket([8u8; 32]).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_ticket_never_works(pool: PgPool) {
    let repo = PgScreenRepo::new(pool);
    let hash = [9u8; 32];
    repo.insert_ticket(
        hash,
        &grant("alice", Mode::View),
        None,
        Utc::now() - Duration::from_secs(1),
    )
    .await
    .unwrap();

    assert_eq!(repo.redeem_ticket(hash).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_user_drives_until_hand_back(pool: PgPool) {
    let repo = PgScreenRepo::new(pool.clone());
    let alice = grant("alice", Mode::Drive);
    let bob = grant("bob", Mode::Drive);
    let alice_session = session(&repo, &alice).await;
    let ana_session = session(&repo, &bob).await;

    let TakeOver::Taken(lease) = repo
        .take_over(&alice, alice_session, Some("Alice".to_owned()), TWO_MINUTES)
        .await
        .unwrap()
    else {
        panic!("alice should drive");
    };
    assert_eq!(lease.session_id, alice_session);

    assert_eq!(
        repo.take_over(&bob, ana_session, None, TWO_MINUTES)
            .await
            .unwrap(),
        TakeOver::Busy(Driver {
            user_id: alice.user_id.clone(),
            name: Some("Alice".to_owned()),
        })
    );

    // Only the driving user hands back.
    let refused = repo
        .release(
            COMPUTER,
            Release::HandBack {
                user_id: bob.user_id.clone(),
                note: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(refused, None);
    let released = repo
        .release(
            COMPUTER,
            Release::HandBack {
                user_id: alice.user_id.clone(),
                note: Some("signed in for you".to_owned()),
            },
        )
        .await
        .unwrap();
    assert_eq!(released.map(|lease| lease.session_id), Some(alice_session));

    assert!(matches!(
        repo.take_over(&bob, ana_session, None, TWO_MINUTES)
            .await
            .unwrap(),
        TakeOver::Taken(_)
    ));

    let agent = alice.agent_user_id.clone().unwrap();
    let notices = repo.take_notices(&agent).await.unwrap();
    let names: Vec<NoticeName> = notices.iter().map(|notice| notice.name).collect();
    assert_eq!(
        names,
        vec![
            NoticeName::TakeOver,
            NoticeName::HandBack,
            NoticeName::TakeOver
        ]
    );
    assert_eq!(notices[1].note.as_deref(), Some("signed in for you"));
    assert!(repo.take_notices(&agent).await.unwrap().is_empty());

    let drives = sqlx::query!(
        r#"SELECT session_id, end_reason FROM computer_screen_drives ORDER BY started_at"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let drives: Vec<(Uuid, Option<String>)> = drives
        .into_iter()
        .map(|drive| (drive.session_id, drive.end_reason))
        .collect();
    assert_eq!(
        drives,
        vec![
            (alice_session.as_uuid(), Some("handBack".to_owned())),
            (ana_session.as_uuid(), None),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_same_user_moves_the_lease_to_a_new_tab(pool: PgPool) {
    let repo = PgScreenRepo::new(pool.clone());
    let alice = grant("alice", Mode::Drive);
    let first = session(&repo, &alice).await;
    let second = session(&repo, &alice).await;

    let TakeOver::Taken(original) = repo
        .take_over(&alice, first, None, TWO_MINUTES)
        .await
        .unwrap()
    else {
        panic!("alice should drive");
    };
    let TakeOver::Taken(moved) = repo
        .take_over(&alice, second, None, TWO_MINUTES)
        .await
        .unwrap()
    else {
        panic!("alice should still drive");
    };

    assert_eq!(moved.session_id, second);
    assert_eq!(moved.started_at, original.started_at);
    assert_eq!(
        repo.renew(COMPUTER, first, TWO_MINUTES).await.unwrap(),
        None
    );
    assert!(
        repo.renew(COMPUTER, second, TWO_MINUTES)
            .await
            .unwrap()
            .is_some()
    );
    // Moving tabs is not a new take-over for the agent.
    let notices = repo
        .take_notices(alice.agent_user_id.as_ref().unwrap())
        .await
        .unwrap();
    assert_eq!(notices.len(), 1);

    // The first tab hands back for both: the drive ends as a hand-back,
    // with its note.
    let released = repo
        .release(
            COMPUTER,
            Release::HandBack {
                user_id: alice.user_id.clone(),
                note: Some("from the first tab".to_owned()),
            },
        )
        .await
        .unwrap();
    assert_eq!(released.map(|lease| lease.session_id), Some(second));
    let notices = repo
        .take_notices(alice.agent_user_id.as_ref().unwrap())
        .await
        .unwrap();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].name, NoticeName::HandBack);
    assert_eq!(notices[0].note.as_deref(), Some("from the first tab"));
    let drive = sqlx::query!(r#"SELECT end_reason FROM computer_screen_drives"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(drive.end_reason.as_deref(), Some("handBack"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lapsed_lease_is_released_and_not_renewed(pool: PgPool) {
    let repo = PgScreenRepo::new(pool);
    let alice = grant("alice", Mode::Drive);
    let bob = grant("bob", Mode::Drive);
    let alice_session = session(&repo, &alice).await;
    let ana_session = session(&repo, &bob).await;
    repo.take_over(&alice, alice_session, None, Duration::ZERO)
        .await
        .unwrap();

    assert_eq!(
        repo.renew(COMPUTER, alice_session, TWO_MINUTES)
            .await
            .unwrap(),
        None
    );
    let agent = alice.agent_user_id.clone().unwrap();
    let held = repo.agent_lease(&agent).await.unwrap().unwrap();
    assert!(!held.is_live(Utc::now()));

    let released = repo.release(COMPUTER, Release::Lapsed).await.unwrap();
    assert_eq!(released.map(|lease| lease.session_id), Some(alice_session));
    assert_eq!(repo.agent_lease(&agent).await.unwrap(), None);
    assert!(matches!(
        repo.take_over(&bob, ana_session, None, TWO_MINUTES)
            .await
            .unwrap(),
        TakeOver::Taken(_)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_lease_does_not_lapse(pool: PgPool) {
    let repo = PgScreenRepo::new(pool);
    let alice = grant("alice", Mode::Drive);
    let alice_session = session(&repo, &alice).await;
    repo.take_over(&alice, alice_session, None, TWO_MINUTES)
        .await
        .unwrap();

    assert_eq!(repo.release(COMPUTER, Release::Lapsed).await.unwrap(), None);
    assert!(repo.lease(COMPUTER).await.unwrap().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_ends_once(pool: PgPool) {
    let repo = PgScreenRepo::new(pool.clone());
    let alice = grant("alice", Mode::View);
    let id = session(&repo, &alice).await;

    repo.end_session(id, EndReason::Stopped, 1000, 20)
        .await
        .unwrap();
    repo.end_session(id, EndReason::Error, 5, 5).await.unwrap();

    let row = sqlx::query!(
        "SELECT end_reason, bytes_to_viewer, bytes_from_viewer FROM computer_screen_sessions WHERE id = $1",
        id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.end_reason.as_deref(), Some("stopped"));
    assert_eq!(row.bytes_to_viewer, 1000);
    assert_eq!(row.bytes_from_viewer, 20);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_watched_or_driven_computer_is_in_use_until_its_socket_goes(pool: PgPool) {
    let repo = PgScreenRepo::new(pool.clone());
    let other = ComputerId::new_from_uuid(Uuid::from_u128(0xC1));
    let quiet = ComputerId::new_from_uuid(Uuid::from_u128(0xC2));
    let candidates = [COMPUTER, other, quiet];

    // Someone watches COMPUTER.
    let watching = session(&repo, &grant("alice", Mode::View)).await;
    assert_eq!(
        repo.computers_in_use(&candidates, TWO_MINUTES)
            .await
            .unwrap(),
        vec![COMPUTER]
    );

    // A socket a crashed process left open stops counting once stale.
    sqlx::query!(
        "UPDATE computer_screen_sessions SET seen_at = now() - interval '10 minutes' WHERE id = $1",
        watching.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.computers_in_use(&candidates, TWO_MINUTES)
            .await
            .unwrap(),
        vec![]
    );
    // Touching it counts it again; closing it ends that.
    repo.touch_session(watching).await.unwrap();
    assert_eq!(
        repo.computers_in_use(&candidates, TWO_MINUTES)
            .await
            .unwrap(),
        vec![COMPUTER]
    );
    repo.end_session(watching, EndReason::Stopped, 0, 0)
        .await
        .unwrap();
    assert_eq!(
        repo.computers_in_use(&candidates, TWO_MINUTES)
            .await
            .unwrap(),
        vec![]
    );

    // Someone drives `other`: its live lease counts even with the socket stale.
    let mut driver_grant = grant("bob", Mode::Drive);
    driver_grant.computer_id = other;
    let driving = session(&repo, &driver_grant).await;
    let TakeOver::Taken(_) = repo
        .take_over(&driver_grant, driving, None, TWO_MINUTES)
        .await
        .unwrap()
    else {
        panic!("nobody else drives");
    };
    sqlx::query!(
        "UPDATE computer_screen_sessions SET seen_at = now() - interval '10 minutes' WHERE id = $1",
        driving.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.computers_in_use(&candidates, TWO_MINUTES)
            .await
            .unwrap(),
        vec![other]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_a_gone_process_left_open_end_as_lost(pool: PgPool) {
    let repo = PgScreenRepo::new(pool.clone());
    let watching = grant("alice", Mode::View);
    let live = session(&repo, &watching).await;
    let leaked = session(&repo, &watching).await;
    sqlx::query!(
        "UPDATE computer_screen_sessions SET seen_at = now() - interval '10 minutes' WHERE id = $1",
        leaked.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.end_lost_sessions(COMPUTER, TWO_MINUTES).await.unwrap(),
        1
    );
    assert_eq!(
        repo.end_lost_sessions(COMPUTER, TWO_MINUTES).await.unwrap(),
        0
    );

    let rows = sqlx::query!(
        r#"SELECT id, end_reason, ended_at = seen_at AS "at_last_seen" FROM computer_screen_sessions ORDER BY id"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let ended: Vec<(Uuid, Option<String>)> = rows
        .iter()
        .map(|row| (row.id, row.end_reason.clone()))
        .collect();
    assert!(ended.contains(&(live.as_uuid(), None)));
    assert!(ended.contains(&(leaked.as_uuid(), Some("lost".to_owned()))));
    assert!(
        rows.iter()
            .find(|row| row.id == leaked.as_uuid())
            .is_some_and(|row| row.at_last_seen == Some(true))
    );
}
