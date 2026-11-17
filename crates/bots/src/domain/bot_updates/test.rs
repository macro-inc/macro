use std::{collections::HashMap, sync::Arc};

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;

use super::{BotChange, BotChangeSource, BotUpdateReads, BotUpdateSubscriptions, BotUpdates};
use crate::domain::models::{BotId, BotIdentity};

const ALICE: &str = "macro|alice@example.com";
const BOB: &str = "macro|bob@example.com";
const SCOUT: BotId = BotId::new_from_uuid(Uuid::from_u128(1));
const HERALD: BotId = BotId::new_from_uuid(Uuid::from_u128(2));
const GHOST: BotId = BotId::new_from_uuid(Uuid::from_u128(3));
const BROKEN: BotId = BotId::new_from_uuid(Uuid::from_u128(4));

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

fn identity(id: BotId, name: &str) -> BotIdentity {
    BotIdentity {
        id,
        name: name.to_string(),
        handle: name.to_lowercase(),
        avatar_url: None,
        deleted_at: None,
        is_system: false,
    }
}

/// Changes the test sends, in order.
struct Changes(Mutex<mpsc::UnboundedReceiver<BotId>>);

impl BotChangeSource for Changes {
    async fn recv(&self) -> Result<BotChange, Report> {
        let bot_id = self
            .0
            .lock()
            .await
            .recv()
            .await
            .expect("test keeps sending");
        Ok(BotChange {
            bot_id,
            span: tracing::Span::none(),
        })
    }
}

/// Scout is seen by Alice, Herald by Alice and Bob; Ghost has no identity;
/// reading Broken fails.
struct Reads;

impl BotUpdateReads for Reads {
    async fn identity(&self, bot_id: BotId) -> Result<Option<BotIdentity>, Report> {
        match bot_id {
            SCOUT => Ok(Some(identity(SCOUT, "Scout"))),
            HERALD => Ok(Some(identity(HERALD, "Herald"))),
            BROKEN => Err(rootcause::report!("replica unavailable")),
            _ => Ok(None),
        }
    }

    async fn audience(&self, bot_id: BotId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let audiences = HashMap::from([
            (SCOUT, vec![user(ALICE)]),
            (HERALD, vec![user(ALICE), user(BOB)]),
            (GHOST, vec![user(ALICE), user(BOB)]),
            (BROKEN, vec![user(ALICE), user(BOB)]),
        ]);
        Ok(audiences.get(&bot_id).cloned().unwrap_or_default())
    }
}

fn start() -> (
    Arc<BotUpdates<Reads, Changes>>,
    mpsc::UnboundedSender<BotId>,
) {
    let (sender, receiver) = mpsc::unbounded_channel();
    let updates = Arc::new(BotUpdates::new(Reads, Changes(Mutex::new(receiver))));
    tokio::spawn({
        let updates = Arc::clone(&updates);
        async move { updates.run().await }
    });
    (updates, sender)
}

#[tokio::test]
async fn a_changed_bot_reaches_only_the_subscribers_who_see_it() {
    let (updates, changes) = start();
    let mut alice = updates.subscribe(user(ALICE));
    let mut bob = updates.subscribe(user(BOB));

    changes.send(SCOUT).unwrap();
    changes.send(HERALD).unwrap();

    assert_eq!(alice.recv().await, Some(identity(SCOUT, "Scout")));
    assert_eq!(alice.recv().await, Some(identity(HERALD, "Herald")));
    // Bob does not see Scout, so Herald is the first update he gets.
    assert_eq!(bob.recv().await, Some(identity(HERALD, "Herald")));
}

#[tokio::test]
async fn changes_that_cannot_be_read_are_skipped_and_delivery_continues() {
    let (updates, changes) = start();
    let mut bob = updates.subscribe(user(BOB));

    changes.send(GHOST).unwrap();
    changes.send(BROKEN).unwrap();
    changes.send(HERALD).unwrap();

    assert_eq!(bob.recv().await, Some(identity(HERALD, "Herald")));
}
