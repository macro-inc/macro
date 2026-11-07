use models_databases::views::LaneKey;
use uuid::Uuid;

use super::{lane_of, stored_lane};
use crate::domain::models::OptionId;
use crate::outbound::pg_databases_repo::PgDatabasesRepoError;

const DONE: OptionId = OptionId::from_uuid(Uuid::from_u128(0xd0e));

#[test]
fn every_lane_is_stored_as_text_that_reads_back_as_it() {
    let lanes = [
        (
            LaneKey::Option(DONE),
            "00000000-0000-0000-0000-000000000d0e",
        ),
        (
            LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
            "user:macro|sam@macro.com",
        ),
        (LaneKey::None, ""),
    ];
    for (lane, stored) in lanes {
        assert_eq!(stored_lane(&lane), stored);
        assert_eq!(lane_of(stored).unwrap(), lane);
    }
}

#[test]
fn a_stored_lane_that_names_nothing_is_corrupt() {
    for stored in ["not a lane", "user:not a user id"] {
        assert!(
            matches!(
                lane_of(stored),
                Err(PgDatabasesRepoError::CorruptLane(found)) if found == stored
            ),
            "{stored}"
        );
    }
}
