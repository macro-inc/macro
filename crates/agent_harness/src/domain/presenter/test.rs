use agent_fold::domain::model::{ActivityRow, ActivityStatus, Segment};

use super::*;

fn prose(index: u32, text: Option<&str>) -> ProjectedSegment {
    ProjectedSegment {
        segment: Segment {
            index,
            kind: SegmentKind::Prose,
            start: index,
            end: index + 1,
            sealed: text.is_some(),
            rows: Vec::new(),
        },
        text: text.map(str::to_owned),
    }
}

fn activity(index: u32, sealed: bool, rows: usize) -> ProjectedSegment {
    ProjectedSegment {
        segment: Segment {
            index,
            kind: SegmentKind::Activity,
            start: index,
            end: index + 1,
            sealed,
            rows: (0..rows)
                .map(|row| ActivityRow {
                    id: format!("t{row}"),
                    label: "Ran".to_owned(),
                    detail: None,
                    status: ActivityStatus::Completed,
                })
                .collect(),
        },
        text: None,
    }
}

fn interaction(index: u32) -> ProjectedSegment {
    ProjectedSegment {
        segment: Segment {
            index,
            kind: SegmentKind::Interaction,
            start: index,
            end: index + 1,
            sealed: true,
            rows: Vec::new(),
        },
        text: None,
    }
}

fn indices(message: &PlannedMessage) -> Vec<u32> {
    message.segments.iter().map(|s| s.segment.index).collect()
}

#[test]
fn each_passage_closes_a_message_that_carries_the_steps_before_it() {
    let planned = plan_messages(&[
        activity(0, true, 2),
        prose(1, Some("Checking first.")),
        activity(2, true, 1),
        prose(3, Some("Found it.")),
    ]);
    assert_eq!(planned.len(), 2);
    assert_eq!(indices(&planned[0]), [0, 1]);
    assert_eq!(indices(&planned[1]), [2, 3]);
    assert!(planned.iter().all(|message| message.ready));
}

#[test]
fn steps_wait_for_the_passage_they_lead_to() {
    let working = plan_messages(&[prose(0, Some("Narration.")), activity(1, false, 1)]);
    assert_eq!(working.len(), 2);
    assert!(working[0].ready);
    assert!(!working[1].ready, "the typing row shows a run in progress");

    let writing = plan_messages(&[activity(0, true, 1), prose(1, None)]);
    assert_eq!(writing.len(), 1);
    assert!(!writing[0].ready, "an unfinished passage is not posted");
}

#[test]
fn steps_the_turn_ends_on_are_a_message_of_their_own() {
    let planned = plan_messages(&closed(vec![
        prose(0, Some("Checking.")),
        activity(1, false, 2),
    ]));
    assert_eq!(planned.len(), 2);
    assert_eq!(indices(&planned[1]), [1]);
}

#[test]
fn requests_for_the_user_belong_to_no_message() {
    let planned = plan_messages(&[
        activity(0, true, 1),
        interaction(1),
        activity(2, true, 1),
        prose(3, Some("Done.")),
    ]);
    assert_eq!(planned.len(), 1);
    assert_eq!(indices(&planned[0]), [0, 2, 3]);
}

#[test]
fn a_growing_reply_never_renumbers_its_earlier_messages() {
    let early = plan_messages(&[activity(0, false, 1)]);
    let writing = plan_messages(&[activity(0, true, 1), prose(1, None)]);
    let later = plan_messages(&[
        activity(0, true, 1),
        prose(1, Some("A.")),
        activity(2, false, 1),
    ]);
    assert_eq!(indices(&early[0]), [0]);
    assert_eq!(indices(&writing[0]), [0, 1]);
    assert_eq!(indices(&later[0]), [0, 1]);
    assert_eq!(indices(&later[1]), [2]);
}

#[test]
fn a_turn_message_shows_finished_passages_and_every_run_of_steps() {
    let shown = turn_segments(&[
        prose(0, Some("A.")),
        activity(1, false, 1),
        interaction(2),
        prose(3, None),
    ]);
    assert_eq!(
        shown.iter().map(|s| s.segment.index).collect::<Vec<_>>(),
        [0, 1]
    );
}

#[test]
fn a_step_inside_an_open_run_does_not_change_the_shape_but_sealing_does() {
    let one = [prose(0, Some("A.")), activity(1, false, 1)];
    let two = [prose(0, Some("A.")), activity(1, false, 2)];
    let sealed = [prose(0, Some("A.")), activity(1, true, 2)];
    assert_eq!(shape(&one), shape(&two));
    assert_ne!(shape(&two), shape(&sealed));
}

#[test]
fn a_sealed_run_whose_step_finishes_late_changes_the_shape() {
    // A call held for permission finishes after the request sealed its run.
    let mut waiting = activity(0, true, 1);
    waiting.segment.rows[0].status = ActivityStatus::Running;
    let mut finished = waiting.clone();
    finished.segment.rows[0].status = ActivityStatus::Completed;
    assert_ne!(shape(&[waiting]), shape(&[finished]));
}

#[test]
fn a_closed_reply_is_sealed_and_runs_nothing() {
    let mut open = activity(1, false, 2);
    open.segment.rows[0].status = ActivityStatus::Running;
    let reply = closed(vec![prose(0, Some("Checking.")), open]);
    assert!(reply.iter().all(|segment| segment.segment.sealed));
    assert_eq!(
        reply[1]
            .segment
            .rows
            .iter()
            .map(|row| row.status)
            .collect::<Vec<_>>(),
        [ActivityStatus::Interrupted, ActivityStatus::Completed]
    );
}
