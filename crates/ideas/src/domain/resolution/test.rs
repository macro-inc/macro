use std::collections::HashSet;
use std::sync::Mutex;

use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{
    Change, ChangeAction, EntityAction, IdeaContent, IdeaState, NewKind, RunMode,
};
use crate::domain::ports::{Limits, Written};
use crate::outbound::pg_idea_repo::PgIdeaRepo;

const OWNER: &str = "macro|ideas-resolve-owner@macro.com";
const OTHER: &str = "macro|ideas-resolve-other@macro.com";
const THREAD: &str = "01900000-0000-7000-8000-0000000000a1";
const CHANNEL: &str = "01900000-0000-7000-8000-0000000000c1";
const DOCUMENT: &str = "document-1";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// People who can't open any item: those in `denied`.
#[derive(Default)]
struct FakeAccess {
    denied: Mutex<HashSet<String>>,
}

impl IdeaAccess for FakeAccess {
    type Err = std::convert::Infallible;

    async fn can_view(&self, user: &MacroUserIdStr<'_>, _: &Target) -> Result<bool, Self::Err> {
        Ok(!self.denied.lock().unwrap().contains(user.as_ref()))
    }

    async fn is_part_of(&self, _: &Target, _: &str) -> Result<bool, Self::Err> {
        Ok(true)
    }
}

struct Harness {
    resolution: IdeaResolution<PgIdeaRepo, FakeAccess>,
    access: Arc<FakeAccess>,
    repo: Arc<PgIdeaRepo>,
    pool: PgPool,
}

async fn harness(pool: PgPool) -> Harness {
    for id in [OWNER, OTHER] {
        crate::outbound::pg_idea_repo::test::insert_user(&pool, id).await;
    }
    let repo = Arc::new(PgIdeaRepo::new(pool.clone()));
    let access = Arc::new(FakeAccess::default());
    Harness {
        resolution: IdeaResolution::new(Arc::clone(&repo), Arc::clone(&access)),
        access,
        repo,
        pool,
    }
}

impl Harness {
    /// A proposed idea of `kind` for `owner` about `about`.
    async fn idea(
        &self,
        owner: &'static str,
        key: &str,
        kind: NewKind,
        about: Vec<Target>,
    ) -> Uuid {
        let generation = Uuid::now_v7();
        sqlx::query!(
            r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
               VALUES ($1, $2, 'nightly', 'ready', now())"#,
            generation,
            owner,
        )
        .execute(&self.pool)
        .await
        .unwrap();
        let id = Uuid::now_v7();
        let content = IdeaContent {
            dedup_key: key.to_owned(),
            title: "Reply to the venue".to_owned(),
            summary: "They asked for a headcount.".to_owned(),
            importance: 50,
            categories: Vec::new(),
            about,
            prompt: match kind {
                NewKind::Prompt { .. } => Some("Draft the reply.".to_owned()),
                NewKind::Entity { .. } => None,
            },
            sends: None,
        };
        let change = Change {
            session: Uuid::now_v7(),
            generation,
            action: ChangeAction::Created,
            old: None,
            new: None,
            reason: None,
            at: Utc::now(),
        };
        let limits = Limits {
            open: 30,
            new_per_generation: 10,
        };
        let written = self
            .repo
            .create(&user(owner), id, &kind, &content, limits, &change)
            .await
            .unwrap();
        assert_eq!(written, Written::Applied);
        id
    }

    async fn state(&self, id: Uuid) -> (String, Option<String>) {
        let row = sqlx::query!("SELECT state, state_reason FROM idea WHERE id = $1", id)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        (row.state, row.state_reason)
    }

    async fn set(&self, owner: &'static str, id: Uuid, to: IdeaState) {
        let moved = self
            .repo
            .set_state(
                &user(owner),
                id,
                &[IdeaState::Proposed],
                to,
                None,
                Utc::now(),
            )
            .await
            .unwrap();
        assert!(moved);
    }
}

fn reply() -> NewKind {
    NewKind::Entity {
        action: EntityAction::Reply,
    }
}

fn target(entity_type: EntityType, entity_id: &str, part_id: Option<&str>) -> Target {
    Target {
        entity_type,
        entity_id: entity_id.to_owned(),
        part_id: part_id.map(str::to_owned),
    }
}

fn thread_item() -> Item {
    Item {
        entity_type: EntityType::EmailThread,
        entity_id: THREAD.to_owned(),
    }
}

fn open() -> (String, Option<String>) {
    ("proposed".to_owned(), None)
}

fn resolved(reason: &str) -> (String, Option<String>) {
    ("resolved".to_owned(), Some(reason.to_owned()))
}

/// The person's own send resolves their reply idea about the thread, and no
/// other: not another kind, not another action, not someone else's.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reply_resolves_only_the_matching_reply_idea_of_that_user(pool: PgPool) {
    let h = harness(pool).await;
    let about = vec![target(EntityType::EmailThread, THREAD, None)];
    let answer = h.idea(OWNER, "reply", reply(), about.clone()).await;
    let review = h
        .idea(
            OWNER,
            "review",
            NewKind::Entity {
                action: EntityAction::Review,
            },
            about.clone(),
        )
        .await;
    let prompt = h
        .idea(
            OWNER,
            "prompt",
            NewKind::Prompt {
                run_mode: RunMode::Composer,
            },
            about.clone(),
        )
        .await;
    let others = h.idea(OTHER, "reply", reply(), about).await;
    let elsewhere = h
        .idea(
            OWNER,
            "elsewhere",
            reply(),
            vec![target(EntityType::EmailThread, "another-thread", None)],
        )
        .await;
    // About one message of the thread: a sent reply names no part, and
    // still answers it.
    let one_message = h
        .idea(
            OWNER,
            "one-message",
            reply(),
            vec![target(EntityType::EmailThread, THREAD, Some("message-7"))],
        )
        .await;

    let outcome = h
        .resolution
        .resolve(&ResolutionEvent::Replied {
            user: user(OWNER),
            item: thread_item(),
            thread: None,
            at: Utc::now(),
        })
        .await
        .unwrap();

    assert_eq!(
        outcome,
        Resolved {
            matched: 2,
            resolved: 2
        }
    );
    assert_eq!(h.state(answer).await, resolved("replied"));
    assert_eq!(h.state(one_message).await, resolved("replied"));
    for id in [review, prompt, others, elsewhere] {
        assert_eq!(h.state(id).await, open());
    }
}

/// A send from before the idea was proposed didn't answer it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reply_from_before_the_idea_leaves_it_open(pool: PgPool) {
    let h = harness(pool).await;
    let answer = h
        .idea(
            OWNER,
            "reply",
            reply(),
            vec![target(EntityType::EmailThread, THREAD, None)],
        )
        .await;

    h.resolution
        .resolve(&ResolutionEvent::Replied {
            user: user(OWNER),
            item: thread_item(),
            thread: None,
            at: Utc::now() - Duration::hours(1),
        })
        .await
        .unwrap();

    assert_eq!(h.state(answer).await, open());
}

/// A reply in a channel thread answers ideas about that thread or the whole
/// channel, not ideas about another thread in it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_reply_resolves_ideas_about_its_thread(pool: PgPool) {
    let h = harness(pool).await;
    let in_thread = h
        .idea(
            OWNER,
            "thread",
            reply(),
            vec![target(EntityType::Channel, CHANNEL, Some("root-1"))],
        )
        .await;
    let channel = h
        .idea(
            OWNER,
            "channel",
            reply(),
            vec![target(EntityType::Channel, CHANNEL, None)],
        )
        .await;
    let other_thread = h
        .idea(
            OWNER,
            "other-thread",
            reply(),
            vec![target(EntityType::Channel, CHANNEL, Some("root-2"))],
        )
        .await;

    // A new top-level post answers the channel, not a thread in it.
    h.resolution
        .resolve(&ResolutionEvent::Replied {
            user: user(OWNER),
            item: Item {
                entity_type: EntityType::Channel,
                entity_id: CHANNEL.to_owned(),
            },
            thread: None,
            at: Utc::now(),
        })
        .await
        .unwrap();
    assert_eq!(h.state(in_thread).await, open());
    assert_eq!(h.state(channel).await, resolved("replied"));

    h.resolution
        .resolve(&ResolutionEvent::Replied {
            user: user(OWNER),
            item: Item {
                entity_type: EntityType::Channel,
                entity_id: CHANNEL.to_owned(),
            },
            thread: Some("root-1".to_owned()),
            at: Utc::now(),
        })
        .await
        .unwrap();

    assert_eq!(h.state(in_thread).await, resolved("replied"));
    assert_eq!(h.state(channel).await, resolved("replied"));
    assert_eq!(h.state(other_thread).await, open());
}

/// Deleting an item resolves the open ideas about it, accepted ones too, and
/// leaves dismissed, retired and done ones as they were.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletion_resolves_open_ideas_about_the_item(pool: PgPool) {
    let h = harness(pool).await;
    let about = vec![
        target(EntityType::EmailThread, THREAD, None),
        target(EntityType::Document, DOCUMENT, None),
    ];
    let proposed = h.idea(OWNER, "proposed", reply(), about.clone()).await;
    let accepted = h.idea(OTHER, "accepted", reply(), about.clone()).await;
    h.set(OTHER, accepted, IdeaState::Accepted).await;
    let mut closed = Vec::new();
    for (key, state) in [
        ("dismissed", IdeaState::Dismissed),
        ("retired", IdeaState::Retired),
        ("done", IdeaState::Done),
    ] {
        let id = h.idea(OWNER, key, reply(), about.clone()).await;
        h.set(OWNER, id, state).await;
        closed.push((id, state.as_ref().to_owned()));
    }

    let outcome = h
        .resolution
        .resolve(&ResolutionEvent::Deleted {
            item: Item {
                entity_type: EntityType::Document,
                entity_id: DOCUMENT.to_owned(),
            },
            part: None,
        })
        .await
        .unwrap();

    assert_eq!(
        outcome,
        Resolved {
            matched: 2,
            resolved: 2
        }
    );
    assert_eq!(h.state(proposed).await, resolved("deleted"));
    assert_eq!(h.state(accepted).await, resolved("deleted"));
    for (id, state) in closed {
        assert_eq!(h.state(id).await, (state, None));
    }
}

/// Deleting one message resolves only ideas about that message.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_part_resolves_only_ideas_about_it(pool: PgPool) {
    let h = harness(pool).await;
    let message = h
        .idea(
            OWNER,
            "message",
            reply(),
            vec![target(EntityType::Channel, CHANNEL, Some("message-1"))],
        )
        .await;
    let channel = h
        .idea(
            OWNER,
            "channel",
            reply(),
            vec![target(EntityType::Channel, CHANNEL, None)],
        )
        .await;

    h.resolution
        .resolve(&ResolutionEvent::Deleted {
            item: Item {
                entity_type: EntityType::Channel,
                entity_id: CHANNEL.to_owned(),
            },
            part: Some("message-1".to_owned()),
        })
        .await
        .unwrap();

    assert_eq!(h.state(message).await, resolved("deleted"));
    assert_eq!(h.state(channel).await, open());
}

/// The same event again changes nothing: the idea stays resolved as first
/// resolved.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn redelivery_is_a_no_op(pool: PgPool) {
    let h = harness(pool).await;
    let id = h
        .idea(
            OWNER,
            "reply",
            reply(),
            vec![target(EntityType::EmailThread, THREAD, None)],
        )
        .await;
    let event = ResolutionEvent::Replied {
        user: user(OWNER),
        item: thread_item(),
        thread: None,
        at: Utc::now(),
    };
    h.resolution.resolve(&event).await.unwrap();
    let first = sqlx::query_scalar!("SELECT state_changed_at FROM idea WHERE id = $1", id)
        .fetch_one(&h.pool)
        .await
        .unwrap();

    let again = h.resolution.resolve(&event).await.unwrap();
    let deleted = h
        .resolution
        .resolve(&ResolutionEvent::Deleted {
            item: thread_item(),
            part: None,
        })
        .await
        .unwrap();

    assert_eq!(again, Resolved::default());
    assert_eq!(deleted, Resolved::default());
    assert_eq!(h.state(id).await, resolved("replied"));
    let after = sqlx::query_scalar!("SELECT state_changed_at FROM idea WHERE id = $1", id)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(after, first);
}

/// After a change to who can open an item, only the ideas of people who can
/// no longer open it are resolved.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lost_access_resolves_only_ideas_of_people_who_lost_it(pool: PgPool) {
    let h = harness(pool).await;
    let about = vec![target(EntityType::Document, DOCUMENT, None)];
    let owners = h.idea(OWNER, "doc", reply(), about.clone()).await;
    let others = h.idea(OTHER, "doc", reply(), about).await;
    h.access.denied.lock().unwrap().insert(OTHER.to_owned());

    let outcome = h
        .resolution
        .resolve(&ResolutionEvent::AccessChanged {
            item: Item {
                entity_type: EntityType::Document,
                entity_id: DOCUMENT.to_owned(),
            },
            users: None,
        })
        .await
        .unwrap();

    assert_eq!(
        outcome,
        Resolved {
            matched: 2,
            resolved: 1
        }
    );
    assert_eq!(h.state(owners).await, open());
    assert_eq!(h.state(others).await, resolved("access_lost"));
}
