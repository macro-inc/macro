use chrono::{Duration, SubsecRound, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::models::{InviteLink, InviteLinkStatus, InviteToken, ListInviteLinks};
use crate::domain::ports::GtmInviteRepo;
use crate::outbound::pg_gtm_invite_repo::PgGtmInviteRepo;

fn staff(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn prospect() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("ada@startup.io").unwrap()
}

fn other_prospect() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("grace@startup.io").unwrap()
}

fn link(created_by: &str, first_name: &str) -> InviteLink {
    // Postgres keeps microseconds; chrono has nanoseconds.
    let now = Utc::now().trunc_subsecs(6);
    InviteLink {
        id: Uuid::now_v7(),
        token: InviteToken::generate(),
        first_name: first_name.into(),
        recipient_email: Some(format!("{}@startup.io", first_name.to_lowercase())),
        note: Some("from the demo".into()),
        promo_code: "1MF".parse().unwrap(),
        created_by: staff(created_by),
        created_at: now,
        expires_at: now + Duration::hours(48),
        revoked_at: None,
        open_count: 0,
        first_opened_at: None,
        redemption: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_and_read_back_by_token_and_id(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let created = link("valentina@macro.com", "Ada");

    repo.insert_link(&created).await.unwrap();

    let by_token = repo
        .get_link_by_token(&created.token)
        .await
        .unwrap()
        .expect("link by token");
    let by_id = repo
        .get_link_by_id(created.id)
        .await
        .unwrap()
        .expect("link by id");

    assert_eq!(by_token, created);
    assert_eq!(by_id, created);
    assert_eq!(by_token.status(Utc::now()), InviteLinkStatus::Active);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unknown_tokens_and_ids_are_none(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);

    assert!(
        repo.get_link_by_token(&InviteToken::generate())
            .await
            .unwrap()
            .is_none()
    );
    assert!(repo.get_link_by_id(Uuid::now_v7()).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tokens_are_unique(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let first = link("valentina@macro.com", "Ada");
    let duplicate = InviteLink {
        id: Uuid::now_v7(),
        ..first.clone()
    };

    repo.insert_link(&first).await.unwrap();

    assert!(repo.insert_link(&duplicate).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_is_newest_first_and_filters_by_creator(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let older = InviteLink {
        created_at: Utc::now() - Duration::hours(2),
        ..link("valentina@macro.com", "Ada")
    };
    let newer = link("valentina@macro.com", "Grace");
    let someone_elses = link("jacob@macro.com", "Linus");
    for link in [&older, &newer, &someone_elses] {
        repo.insert_link(link).await.unwrap();
    }

    let everyone = repo
        .list_links(&ListInviteLinks {
            created_by: None,
            limit: 100,
        })
        .await
        .unwrap();
    let first_names: Vec<_> = everyone.iter().map(|l| l.first_name.as_str()).collect();
    assert_eq!(first_names.len(), 3);
    assert_eq!(first_names.last(), Some(&"Ada"));

    let valentinas = repo
        .list_links(&ListInviteLinks {
            created_by: Some(staff("valentina@macro.com")),
            limit: 100,
        })
        .await
        .unwrap();
    let ids: Vec<_> = valentinas.iter().map(|l| l.id).collect();
    assert_eq!(ids, vec![newer.id, older.id]);

    let limited = repo
        .list_links(&ListInviteLinks {
            created_by: None,
            limit: 1,
        })
        .await
        .unwrap();
    assert_eq!(limited.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn record_open_counts_and_keeps_the_first_open_time(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let created = link("valentina@macro.com", "Ada");
    repo.insert_link(&created).await.unwrap();
    let first_open = Utc::now() - Duration::minutes(10);
    let second_open = Utc::now();

    repo.record_open(created.id, first_open).await.unwrap();
    repo.record_open(created.id, second_open).await.unwrap();

    let opened = repo.get_link_by_id(created.id).await.unwrap().unwrap();
    assert_eq!(opened.open_count, 2);
    assert_eq!(
        opened.first_opened_at.map(|t| t.timestamp_millis()),
        Some(first_open.timestamp_millis())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoke_only_touches_open_links(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let created = link("valentina@macro.com", "Ada");
    repo.insert_link(&created).await.unwrap();

    assert!(repo.revoke_link(created.id, Utc::now()).await.unwrap());
    // Already revoked: nothing to do.
    assert!(!repo.revoke_link(created.id, Utc::now()).await.unwrap());
    let revoked = repo.get_link_by_id(created.id).await.unwrap().unwrap();
    assert_eq!(revoked.status(Utc::now()), InviteLinkStatus::Revoked);

    let redeemed = link("valentina@macro.com", "Grace");
    repo.insert_link(&redeemed).await.unwrap();
    repo.redeem_link(redeemed.id, &prospect(), Utc::now())
        .await
        .unwrap()
        .expect("redeemed");
    assert!(!repo.revoke_link(redeemed.id, Utc::now()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn redeem_is_first_come_and_idempotent_for_the_winner(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let created = link("valentina@macro.com", "Ada");
    repo.insert_link(&created).await.unwrap();
    let now = Utc::now();

    let redeemed = repo
        .redeem_link(created.id, &prospect(), now)
        .await
        .unwrap()
        .expect("first redemption wins");
    assert!(redeemed.is_redeemed_by(&prospect()));
    assert_eq!(redeemed.status(now), InviteLinkStatus::Redeemed);

    // Same user again keeps the original redemption time.
    let again = repo
        .redeem_link(created.id, &prospect(), now + Duration::hours(1))
        .await
        .unwrap()
        .expect("idempotent for the same user");
    assert_eq!(
        again
            .redemption
            .as_ref()
            .map(|r| r.redeemed_at.timestamp_millis()),
        Some(now.timestamp_millis())
    );

    // Someone else is refused.
    assert!(
        repo.redeem_link(created.id, &other_prospect(), now)
            .await
            .unwrap()
            .is_none()
    );

    let stored = repo
        .get_redeemed_link_for_user(&prospect())
        .await
        .unwrap()
        .expect("lookup by redeemer");
    assert_eq!(stored.id, created.id);
    assert!(
        repo.get_redeemed_link_for_user(&other_prospect())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn redeem_refuses_expired_and_revoked_links(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let expired = InviteLink {
        expires_at: Utc::now() - Duration::minutes(1),
        ..link("valentina@macro.com", "Ada")
    };
    repo.insert_link(&expired).await.unwrap();
    assert!(
        repo.redeem_link(expired.id, &prospect(), Utc::now())
            .await
            .unwrap()
            .is_none()
    );

    let revoked = link("valentina@macro.com", "Grace");
    repo.insert_link(&revoked).await.unwrap();
    repo.revoke_link(revoked.id, Utc::now()).await.unwrap();
    assert!(
        repo.redeem_link(revoked.id, &prospect(), Utc::now())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_user_can_only_hold_one_redeemed_link(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let first = link("valentina@macro.com", "Ada");
    let second = link("jacob@macro.com", "Ada");
    repo.insert_link(&first).await.unwrap();
    repo.insert_link(&second).await.unwrap();

    repo.redeem_link(first.id, &prospect(), Utc::now())
        .await
        .unwrap()
        .expect("first link redeemed");

    // The partial unique index on redeemed_by_user_id rejects a second link.
    assert!(
        repo.redeem_link(second.id, &prospect(), Utc::now())
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_converted_records_the_subscription_once(pool: Pool<Postgres>) {
    let repo = PgGtmInviteRepo::new(pool);
    let created = link("valentina@macro.com", "Ada");
    repo.insert_link(&created).await.unwrap();

    // Nobody redeemed it yet: nothing to convert.
    assert!(
        !repo
            .mark_converted(&prospect(), "sub_1", Utc::now())
            .await
            .unwrap()
    );

    repo.redeem_link(created.id, &prospect(), Utc::now())
        .await
        .unwrap()
        .unwrap();

    assert!(
        repo.mark_converted(&prospect(), "sub_1", Utc::now())
            .await
            .unwrap()
    );
    // A second subscription event does not overwrite the first.
    assert!(
        !repo
            .mark_converted(&prospect(), "sub_2", Utc::now())
            .await
            .unwrap()
    );

    let converted = repo.get_link_by_id(created.id).await.unwrap().unwrap();
    assert_eq!(converted.status(Utc::now()), InviteLinkStatus::Converted);
    let conversion = converted
        .redemption
        .and_then(|redemption| redemption.conversion)
        .expect("conversion recorded");
    assert_eq!(conversion.stripe_subscription_id.as_deref(), Some("sub_1"));
}
