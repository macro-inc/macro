use uuid::Uuid;

use super::*;

#[test]
fn a_batch_keeps_each_targets_last_change_in_recording_order() {
    let event = Uuid::from_u128(1);
    let calendar = Uuid::from_u128(2);
    let other = Uuid::from_u128(3);

    let ops = latest_per_target(vec![
        CalendarChangeOp::UpsertEvent(event),
        CalendarChangeOp::UpsertCalendar(calendar),
        CalendarChangeOp::UpsertEvent(other),
        CalendarChangeOp::DeleteEvent(event),
    ]);

    assert_eq!(
        ops,
        vec![
            CalendarChangeOp::UpsertCalendar(calendar),
            CalendarChangeOp::UpsertEvent(other),
            CalendarChangeOp::DeleteEvent(event),
        ]
    );
}

#[test]
fn an_event_and_a_calendar_sharing_an_id_stay_distinct() {
    let id = Uuid::from_u128(7);

    let ops = latest_per_target(vec![
        CalendarChangeOp::UpsertEvent(id),
        CalendarChangeOp::DeleteCalendar(id),
    ]);

    assert_eq!(ops.len(), 2);
}

#[test]
fn kinds_round_trip_through_their_storage_codes() {
    let id = Uuid::from_u128(9);
    for op in [
        CalendarChangeOp::UpsertEvent(id),
        CalendarChangeOp::DeleteEvent(id),
        CalendarChangeOp::UpsertCalendar(id),
        CalendarChangeOp::DeleteCalendar(id),
    ] {
        let (event_id, calendar_id) = match op {
            CalendarChangeOp::UpsertEvent(id) | CalendarChangeOp::DeleteEvent(id) => {
                (Some(id), None)
            }
            _ => (None, Some(id)),
        };
        assert_eq!(
            op_from_row(kind_code(op), event_id, calendar_id).unwrap(),
            op
        );
    }
    assert!(op_from_row(1, None, Some(id)).is_err());
    assert!(op_from_row(5, Some(id), None).is_err());
}
