mod migration;

use super::PgNotificationState;
use crate::NotificationState;
use sqlx::{Postgres, Type, TypeInfo};

#[test]
fn postgres_mapping_round_trips_every_state() {
    for state in [
        NotificationState::Unseen,
        NotificationState::Seen,
        NotificationState::Done,
    ] {
        assert_eq!(
            NotificationState::from(PgNotificationState::from(state)),
            state
        );
    }
}

#[test]
fn postgres_type_matches_the_migration() {
    assert_eq!(
        <PgNotificationState as Type<Postgres>>::type_info().name(),
        "notification_state",
    );
}
