//! Sources: following, detaching, and the chain a gate reads.

use std::sync::Arc;

use tokio::sync::Barrier;

use super::*;
use crate::domain::model::{CatalogEntry, Follows, Origin};
use crate::domain::ports::SourceWrite;
use crate::domain::resolve::{Resolver, materialize};
use crate::outbound::registry::registry_catalog;

/// The fixtures' agents: `AGENT`, then `sources.sql`'s six.
fn agent(index: u128) -> BotId {
    BotId::new_from_uuid(Uuid::from_u128(
        0x91000000_0000_0000_0000_000000000021 + index,
    ))
}

async fn policy(store: &PgPermissionStore, index: u128) -> PolicyId {
    store
        .ensure_policy(&PolicyOwner::Agent(agent(index)))
        .await
        .unwrap()
}

/// `count` agents' policies, in fixture order.
async fn policies(store: &PgPermissionStore, count: u128) -> Vec<PolicyId> {
    let mut ids = Vec::new();
    for index in 0..count {
        ids.push(policy(store, index).await);
    }
    ids
}

async fn follow(
    store: &PgPermissionStore,
    follower: PolicyId,
    source: PolicyId,
) -> Result<(), PermissionError> {
    let owner = user(OWNER);
    store
        .set_source(
            SourceWrite {
                policy: follower,
                by: &owner,
            },
            source,
        )
        .await
        .unwrap()
}

/// Detach `policy`, keeping the snapshot of what it resolved to.
async fn detach(store: &PgPermissionStore, policy: PolicyId) -> usize {
    let owner = user(OWNER);
    let catalog = registry_catalog();
    store
        .detach(SourceWrite { policy, by: &owner }, |chain| {
            Ok(materialize(&catalog, chain))
        })
        .await
        .unwrap()
        .unwrap()
}

async fn chain(store: &PgPermissionStore, policy: PolicyId) -> PolicyChain {
    store.chain(policy).await.unwrap().unwrap()
}

fn ids(chain: &PolicyChain) -> Vec<PolicyId> {
    chain.levels().map(|level| level.id).collect()
}

fn send_message() -> CatalogEntry {
    registry_catalog()
        .entry("email", "send_message")
        .unwrap()
        .clone()
}

fn send_message_rule(state: Option<PermissionState>) -> Change {
    Change {
        target: Target::Tool {
            service: "email".to_owned(),
            operation: "send_message".to_owned(),
        },
        state,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn setting_a_source_that_would_form_a_cycle_is_refused(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let [a, b, c] = policies(&store, 3).await[..] else {
        unreachable!()
    };
    follow(&store, a, b).await.unwrap();
    follow(&store, b, c).await.unwrap();
    assert_eq!(ids(&chain(&store, a).await), [a, b, c]);

    assert!(matches!(
        follow(&store, c, a).await,
        Err(PermissionError::SourceCycle)
    ));
    assert!(matches!(
        follow(&store, b, a).await,
        Err(PermissionError::SourceCycle)
    ));
    assert!(matches!(
        follow(&store, a, a).await,
        Err(PermissionError::SourceNotAllowed)
    ));
    // A persona's policy is a root: it never follows.
    let persona = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        })
        .await
        .unwrap();
    assert!(matches!(
        follow(&store, persona, a).await,
        Err(PermissionError::SourceNotAllowed)
    ));
    // But anyone's agent may follow it.
    follow(&store, c, persona).await.unwrap();
    assert_eq!(ids(&chain(&store, a).await), [a, b, c, persona]);
    assert!(matches!(
        follow(&store, a, PolicyId::generate()).await,
        Err(PermissionError::NotFound)
    ));
    // Nothing a refusal touched changed.
    assert_eq!(ids(&chain(&store, c).await), [c, persona]);
}

/// A→B and B→A started together: the global sources lock serializes them,
/// so the second sees the first and is refused, and no chain is a cycle.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn concurrent_set_sources_never_form_a_cycle(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let [a, b] = policies(&store, 2).await[..] else {
        unreachable!()
    };
    for _ in 0..10 {
        let barrier = Arc::new(Barrier::new(2));
        let race = |follower: PolicyId, source: PolicyId| {
            let (store, barrier) = (store.clone(), Arc::clone(&barrier));
            tokio::spawn(async move {
                barrier.wait().await;
                follow(&store, follower, source).await
            })
        };
        let (first, second) = (race(a, b), race(b, a));
        let outcomes = [first.await.unwrap(), second.await.unwrap()];
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        assert!(
            outcomes
                .iter()
                .any(|outcome| matches!(outcome, Err(PermissionError::SourceCycle)))
        );
        // Both chains read (a cycle would be an error) and one follows the
        // other.
        let (of_a, of_b) = (chain(&store, a).await, chain(&store, b).await);
        assert_eq!(of_a.depth() + of_b.depth(), 3);
        for policy in [a, b] {
            if chain(&store, policy).await.follows() {
                detach(&store, policy).await;
            }
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn a_chain_longer_than_the_limit_is_refused(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let all = policies(&store, 7).await;
    // Five policies in a row: the limit.
    for pair in all[..5].windows(2) {
        follow(&store, pair[0], pair[1]).await.unwrap();
    }
    assert_eq!(chain(&store, all[0]).await.depth(), 5);
    assert!(matches!(
        follow(&store, all[5], all[0]).await,
        Err(PermissionError::SourceTooDeep)
    ));
    // Its followers count too: 6 ← 5 has two policies below the source.
    follow(&store, all[6], all[5]).await.unwrap();
    assert_eq!(store.followers_height(all[5]).await.unwrap(), 2);
    assert_eq!(store.followers_height(all[4]).await.unwrap(), 5);
    follow(&store, all[5], all[2]).await.unwrap();
    assert_eq!(chain(&store, all[6]).await.depth(), 5);
    assert!(matches!(
        follow(&store, all[5], all[1]).await,
        Err(PermissionError::SourceTooDeep)
    ));
    // The refused change left the accepted one.
    assert_eq!(
        ids(&chain(&store, all[5]).await),
        [all[5], all[2], all[3], all[4]]
    );

    // Only hand-edited data makes a cycle; reading it is an error, and so is
    // a gate's read.
    sqlx::query!(
        "UPDATE agent_permission_policy SET follows = true, source_policy_id = $2 WHERE id = $1",
        all[4].as_uuid(),
        all[0].as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        store.chain(all[0]).await,
        Err(PgPermissionStoreError::Chain(ChainError::Cycle))
    ));
    assert!(matches!(
        store
            .chain_with_session(all[6], AgentSessionId::new_from_uuid(SESSION))
            .await,
        Err(PgPermissionStoreError::Chain(ChainError::TooDeep))
    ));
}

/// A gate has read a follower's chain (its source says nothing: always)
/// when a person sets the source's Never and the agent drops its own Never
/// from the session. The gate's snapshot still holds the source before the
/// edit with the overlay before the drop, so no read pairs them into always.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn a_gate_reads_the_chain_rules_and_overlay_as_one_snapshot(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let [follower, source] = policies(&store, 2).await[..] else {
        unreachable!()
    };
    follow(&store, follower, source).await.unwrap();
    let session = AgentSessionId::new_from_uuid(SESSION);
    store
        .apply_session(
            session,
            &[send_message_rule(Some(PermissionState::Never))],
            &user(OTHER),
        )
        .await
        .unwrap();

    let mut gate = pool.begin_with(SNAPSHOT).await.unwrap();
    let before = read_chain(&mut gate, follower).await.unwrap().unwrap();
    assert!(before.levels().all(|level| level.rules.is_empty()));

    store
        .apply(
            source,
            &[send_message_rule(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    store
        .apply_session(session, &[send_message_rule(None)], &user(OTHER))
        .await
        .unwrap();

    let overlay = overlay_rules(&mut gate, session).await.unwrap();
    let again = read_chain(&mut gate, follower).await.unwrap().unwrap();
    gate.commit().await.unwrap();
    assert_eq!(again, before);
    assert_eq!(
        Resolver::new(&before, &overlay).entry(&send_message()).0,
        PermissionState::Never
    );

    // The next read sees both changes.
    let (after, overlay) = store
        .chain_with_session(follower, session)
        .await
        .unwrap()
        .unwrap();
    assert!(overlay.is_empty());
    assert_eq!(
        Resolver::new(&after, &overlay).entry(&send_message()),
        (PermissionState::Never, Origin::Source)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn set_source_drops_person_rows_and_keeps_restrictions(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let [follower, first, second] = policies(&store, 3).await[..] else {
        unreachable!()
    };
    store
        .apply(
            follower,
            &[group_action(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    store
        .apply(
            follower,
            &[tool(Some(PermissionState::Ask))],
            &user(OWNER),
            SetBy::Agent,
        )
        .await
        .unwrap();
    follow(&store, follower, first).await.unwrap();
    assert_eq!(
        states(&store.rules(follower).await.unwrap()),
        [(
            "static-files.delete_file".to_owned(),
            PermissionState::Ask,
            true,
            true
        )]
    );
    let stored = sqlx::query!(
        "SELECT follows, source_policy_id, source_set_by, source_set_at FROM agent_permission_policy WHERE id = $1",
        follower.as_uuid(),
    )
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert!(stored.follows);
    assert_eq!(stored.source_policy_id, Some(first.as_uuid()));
    assert_eq!(stored.source_set_by.as_deref(), Some(OWNER));
    assert!(stored.source_set_at.is_some());

    // Changing sources keeps every row: while following, all are local.
    store
        .apply(
            follower,
            &[default(Some(PermissionState::Ask))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    follow(&store, follower, second).await.unwrap();
    assert_eq!(store.rules(follower).await.unwrap().len(), 2);
    assert_eq!(ids(&chain(&store, follower).await), [follower, second]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn detach_is_one_transaction(pool: PgPool) {
    let store = PgPermissionStore::new(pool);
    let [follower, source] = policies(&store, 2).await[..] else {
        unreachable!()
    };
    store
        .apply(
            source,
            &[default(Some(PermissionState::Ask))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    follow(&store, follower, source).await.unwrap();
    store
        .apply(
            follower,
            &[send_message_rule(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Agent,
        )
        .await
        .unwrap();

    // A row the table refuses (a stored always default) fails the insert
    // after the delete: nothing of it stays.
    let owner = user(OWNER);
    let failed = store
        .detach(
            SourceWrite {
                policy: follower,
                by: &owner,
            },
            |_| {
                Ok(vec![Rule {
                    target: Target::Action {
                        action: Action::Send,
                    },
                    state: PermissionState::Always,
                    via_agent: false,
                    restriction_only: false,
                    updated_at: chrono::Utc::now(),
                }])
            },
        )
        .await;
    assert!(failed.is_err());
    let kept = chain(&store, follower).await;
    assert_eq!(ids(&kept), [follower, source]);
    assert_eq!(states(kept.rules()).len(), 1);

    // A refused plan changes nothing either.
    let refused = store
        .detach(
            SourceWrite {
                policy: follower,
                by: &owner,
            },
            |_| Err(PermissionError::Forbidden),
        )
        .await
        .unwrap();
    assert!(matches!(refused, Err(PermissionError::Forbidden)));
    assert_eq!(ids(&chain(&store, follower).await), [follower, source]);

    // A detach owns the snapshot: the source's default and its own
    // restriction, which keeps its flags.
    assert_eq!(detach(&store, follower).await, 2);
    let own = chain(&store, follower).await;
    assert_eq!(own.policy().follows, Follows::Own);
    assert_eq!(
        states(own.rules()),
        [
            (
                "email.send_message".to_owned(),
                PermissionState::Never,
                true,
                true
            ),
            ("send".to_owned(), PermissionState::Ask, false, false),
        ]
    );
    // The source is untouched.
    assert_eq!(store.rules(source).await.unwrap().len(), 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn hard_deleting_a_source_leaves_its_followers_lost(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let [follower, source, other] = policies(&store, 3).await[..] else {
        unreachable!()
    };
    follow(&store, follower, source).await.unwrap();
    let persona = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OTHER),
        })
        .await
        .unwrap();
    follow(&store, other, persona).await.unwrap();

    sqlx::query!("DELETE FROM bots WHERE id = $1", agent(1).as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, OTHER)
        .execute(&pool)
        .await
        .unwrap();

    for policy in [follower, other] {
        let lost = chain(&store, policy).await;
        assert_eq!(lost.depth(), 1);
        assert_eq!(lost.policy().follows, Follows::Lost);
        assert_eq!(
            Resolver::new(&lost, &[]).entry(&send_message()),
            (PermissionState::Ask, Origin::Source)
        );
    }
    // Picking a source again ends it.
    follow(&store, follower, other).await.unwrap();
    assert_eq!(ids(&chain(&store, follower).await), [follower, other]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn a_deleted_source_stays_frozen(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let [follower, source] = policies(&store, 2).await[..] else {
        unreachable!()
    };
    store
        .apply(
            source,
            &[send_message_rule(Some(PermissionState::Never))],
            &user(OWNER),
            SetBy::Person,
        )
        .await
        .unwrap();
    follow(&store, follower, source).await.unwrap();
    // Agents are soft-deleted: the policy and its rules stay.
    sqlx::query!(
        "UPDATE bots SET deleted_at = now() WHERE id = $1",
        agent(1).as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let frozen = chain(&store, follower).await;
    assert_eq!(ids(&frozen), [follower, source]);
    assert_eq!(
        Resolver::new(&frozen, &[]).entry(&send_message()),
        (PermissionState::Never, Origin::Source)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("permissions", "sources"))
)]
async fn the_policy_table_refuses_a_root_that_follows_and_a_source_without_following(pool: PgPool) {
    let store = PgPermissionStore::new(pool.clone());
    let [agent_policy] = policies(&store, 1).await[..] else {
        unreachable!()
    };
    let persona = store
        .ensure_policy(&PolicyOwner::Persona {
            persona: MACRO_NEW_BOT_ID,
            user: user(OWNER),
        })
        .await
        .unwrap();
    let set = |policy: PolicyId, follows: bool, source: Option<PolicyId>| {
        let pool = pool.clone();
        async move {
            sqlx::query!(
                "UPDATE agent_permission_policy SET follows = $2, source_policy_id = $3 WHERE id = $1",
                policy.as_uuid(),
                follows,
                source.map(|source| source.as_uuid()),
            )
            .execute(&pool)
            .await
        }
    };
    assert!(set(persona, true, Some(agent_policy)).await.is_err());
    assert!(set(agent_policy, false, Some(persona)).await.is_err());
    assert!(set(agent_policy, true, Some(agent_policy)).await.is_err());
    // Following a lost source is a state the deletes leave.
    assert!(set(agent_policy, true, None).await.is_ok());
}
