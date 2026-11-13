mod migration;

use super::{PgNotificationLane, PgNotificationState};
use crate::{NotificationLane, NotificationState};
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

#[test]
fn postgres_mapping_round_trips_every_lane() {
    for lane in [NotificationLane::Signal, NotificationLane::Noise] {
        assert_eq!(NotificationLane::from(PgNotificationLane::from(lane)), lane);
    }
}

#[test]
fn postgres_lane_type_matches_the_migration() {
    assert_eq!(
        <PgNotificationLane as Type<Postgres>>::type_info().name(),
        "notification_lane",
    );
}
