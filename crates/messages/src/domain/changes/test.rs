use super::*;

fn message(seq: i64, message: u128, root: u128) -> ChannelChange {
    ChannelChange {
        seq,
        op: ChannelChangeOp::Message {
            message_id: Uuid::from_u128(message),
            root_id: Uuid::from_u128(root),
        },
    }
}

fn log(counter: i64, changes: Vec<ChannelChange>) -> ChannelChangeLog {
    ChannelChangeLog { counter, changes }
}

#[test]
fn a_current_reader_has_nothing_to_load() {
    let plan = ChannelChangePlan::new(7, &log(7, vec![]), MAX_CHANGE_ROWS);
    assert_eq!(
        plan,
        ChannelChangePlan {
            seq: 7,
            ..ChannelChangePlan::default()
        }
    );
}

#[test]
fn each_changed_message_is_loaded_once_and_a_reply_reloads_its_root() {
    let changes = vec![
        message(4, 1, 1),
        message(5, 2, 1),
        message(6, 2, 1),
        ChannelChange {
            seq: 7,
            op: ChannelChangeOp::Activity(Uuid::from_u128(9)),
        },
        message(8, 3, 3),
    ];
    let plan = ChannelChangePlan::new(3, &log(8, changes), MAX_CHANGE_ROWS);
    assert!(!plan.reset);
    assert_eq!(plan.seq, 8);
    assert!(!plan.has_more);
    assert_eq!(plan.roots, [Uuid::from_u128(1), Uuid::from_u128(3)]);
    assert_eq!(plan.replies, [Uuid::from_u128(2)]);
    assert_eq!(plan.activities, [Uuid::from_u128(9)]);
}

#[test]
fn a_full_slice_stops_at_its_last_row_and_reports_more() {
    let plan = ChannelChangePlan::new(0, &log(5, vec![message(1, 1, 1), message(2, 2, 2)]), 2);
    assert_eq!(plan.seq, 2);
    assert!(plan.has_more);
    // The slice that ends exactly at the counter has nothing after it.
    let plan = ChannelChangePlan::new(3, &log(5, vec![message(4, 1, 1), message(5, 2, 2)]), 2);
    assert_eq!(plan.seq, 5);
    assert!(!plan.has_more);
}

#[test]
fn a_reader_the_log_cannot_catch_up_starts_over_from_the_counter() {
    let reset = ChannelChangePlan {
        reset: true,
        seq: 50,
        ..ChannelChangePlan::default()
    };
    // Retention removed the change after the reader's number.
    assert_eq!(
        ChannelChangePlan::new(9, &log(50, vec![]), MAX_CHANGE_ROWS),
        reset
    );
    assert_eq!(
        ChannelChangePlan::new(9, &log(50, vec![message(11, 1, 1)]), MAX_CHANGE_ROWS),
        reset
    );
    // A reader whose next change is kept has every change after it.
    assert!(!ChannelChangePlan::new(10, &log(50, vec![message(11, 1, 1)]), 1).reset);
    // The channel never issued this number.
    assert_eq!(
        ChannelChangePlan::new(51, &log(50, vec![]), MAX_CHANGE_ROWS),
        reset
    );
    assert_eq!(
        ChannelChangePlan::new(-1, &log(50, vec![]), MAX_CHANGE_ROWS),
        reset
    );
    // An import put messages anywhere in the history.
    let imported = ChannelChange {
        seq: 50,
        op: ChannelChangeOp::HistoryImported,
    };
    assert_eq!(
        ChannelChangePlan::new(49, &log(50, vec![imported]), MAX_CHANGE_ROWS),
        reset
    );
}

#[test]
fn a_reader_too_far_behind_starts_over_instead_of_replaying() {
    let counter = CHANGE_RESET_BACKLOG + 5;
    let at_limit = ChannelChangePlan::new(5, &log(counter, vec![message(6, 1, 1)]), 1);
    assert!(!at_limit.reset);
    let past_limit = ChannelChangePlan::new(4, &log(counter, vec![message(5, 1, 1)]), 1);
    assert!(past_limit.reset);
}

#[test]
fn a_channel_without_changes_is_current_at_zero() {
    let plan = ChannelChangePlan::new(0, &ChannelChangeLog::default(), MAX_CHANGE_ROWS);
    assert_eq!(plan, ChannelChangePlan::default());
}

mod sequenced_activities {
    use std::sync::{Arc, Mutex};

    use activity::domain::models::NameChange;
    use activity::domain::ports::ActivityRepo;
    use activity::{Action, Activity, Actor, DomainActivity, EntityType};

    use super::*;
    use crate::domain::ports::MessageError;

    struct ChannelFact(String, Action);

    impl DomainActivity for ChannelFact {
        const ENTITY_TYPE: EntityType = EntityType::Channel;

        fn entity_id(&self) -> &str {
            &self.0
        }

        fn into_action(self) -> Action {
            self.1
        }
    }

    fn fact(id: u128, channel: Uuid, action: Action) -> Activity {
        Activity::from_domain(
            Uuid::from_u128(id),
            0,
            Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap()),
            None,
            ChannelFact(channel.to_string(), action),
            Utc::now(),
        )
    }

    fn renamed() -> Action {
        Action::Renamed(NameChange {
            from: None,
            to: Some("New".into()),
        })
    }

    #[derive(Clone, Default)]
    struct Store {
        stored: Arc<Mutex<Vec<Uuid>>>,
        fail: bool,
    }

    impl ActivityRepo for Store {
        type Err = std::io::Error;

        async fn insert_activities(&self, activities: &[Activity]) -> Result<(), Self::Err> {
            if self.fail {
                return Err(std::io::Error::other("store is down"));
            }
            self.stored
                .lock()
                .unwrap()
                .extend(activities.iter().map(|fact| fact.id));
            Ok(())
        }

        async fn purge_entities(&self, _: &[(EntityType, String)]) -> Result<(), Self::Err> {
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct Log {
        blocks: Arc<Mutex<Vec<(Uuid, Vec<Uuid>)>>>,
        fail: bool,
    }

    impl ChannelActivityLog for Log {
        async fn record_activities(
            &self,
            channel_id: Uuid,
            activity_ids: &[Uuid],
        ) -> Result<Option<i64>, MessageError> {
            if self.fail {
                return Err(MessageError::NotFound);
            }
            let mut blocks = self.blocks.lock().unwrap();
            blocks.push((channel_id, activity_ids.to_vec()));
            Ok(Some(blocks.len() as i64))
        }
    }

    #[tokio::test]
    async fn stored_timeline_facts_are_logged_once_per_channel_in_order() {
        let (first, second) = (Uuid::from_u128(10), Uuid::from_u128(11));
        let (store, log) = (Store::default(), Log::default());
        let facts = [
            fact(1, first, renamed()),
            // Edits are stored but no timeline shows them.
            fact(2, first, Action::Edited),
            fact(3, second, renamed()),
            fact(4, first, renamed()),
        ];
        ChannelSequencedActivities::new(store.clone(), log.clone())
            .insert_activities(&facts)
            .await
            .unwrap();
        assert_eq!(store.stored.lock().unwrap().len(), 4);
        assert_eq!(
            *log.blocks.lock().unwrap(),
            [
                (first, vec![facts[0].id, facts[3].id]),
                (second, vec![facts[2].id]),
            ]
        );
    }

    #[tokio::test]
    async fn a_failed_store_logs_nothing_and_a_failed_log_fails_the_batch() {
        let channel = Uuid::from_u128(10);
        let facts = [fact(1, channel, renamed())];
        let log = Log::default();
        let failed_store = Store {
            fail: true,
            ..Store::default()
        };
        let error = ChannelSequencedActivities::new(failed_store, log.clone())
            .insert_activities(&facts)
            .await
            .unwrap_err();
        assert!(matches!(error, SequencedActivityError::Store(_)));
        assert!(log.blocks.lock().unwrap().is_empty());

        // The source batch is retried, so the fact reaches the log later.
        let failed_log = Log {
            fail: true,
            ..Log::default()
        };
        let error = ChannelSequencedActivities::new(Store::default(), failed_log)
            .insert_activities(&facts)
            .await
            .unwrap_err();
        assert!(
            matches!(error, SequencedActivityError::Log { channel_id, .. } if channel_id == channel)
        );
    }
}

#[test]
fn a_message_and_an_activity_with_one_id_are_both_loaded() {
    let shared = Uuid::from_u128(4);
    let changes = vec![
        ChannelChange {
            seq: 1,
            op: ChannelChangeOp::Activity(shared),
        },
        message(2, 4, 4),
    ];
    let plan = ChannelChangePlan::new(0, &log(2, changes), MAX_CHANGE_ROWS);
    assert_eq!(plan.roots, [shared]);
    assert_eq!(plan.activities, [shared]);
}
