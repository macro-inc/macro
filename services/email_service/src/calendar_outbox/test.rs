use super::*;

fn row(kind: &str) -> OutboxRow {
    OutboxRow {
        id: Uuid::now_v7(),
        backfill_job_id: Uuid::now_v7(),
        email_link_id: Uuid::now_v7(),
        kind: kind.to_string(),
    }
}

#[test]
fn maps_google_calendar_kind() {
    assert!(matches!(
        to_queue_message(&row("google_calendar"))
            .unwrap()
            .backfill_operation,
        BackfillOperation::CalendarGoogleBackfill(_)
    ));
}

#[test]
fn rejects_unknown_kind() {
    assert!(to_queue_message(&row("unknown")).is_err());
}

#[test]
fn maps_email_completion_outbox() {
    let row = EmailCompletionOutboxRow {
        id: Uuid::now_v7(),
        backfill_job_id: Uuid::now_v7(),
        email_link_id: Some(Uuid::now_v7()),
    };

    let BackfillOperation::FinalizeBackfill(scope) = to_email_completion_message(&row)
        .unwrap()
        .backfill_operation
    else {
        panic!("expected finalize-backfill operation");
    };
    assert_eq!(scope.job_id, row.backfill_job_id);
    assert_eq!(Some(scope.link_id), row.email_link_id);
}

#[test]
fn skips_email_completion_when_link_was_deleted() {
    let row = EmailCompletionOutboxRow {
        id: Uuid::now_v7(),
        backfill_job_id: Uuid::now_v7(),
        email_link_id: None,
    };

    assert!(to_email_completion_message(&row).is_none());
}
