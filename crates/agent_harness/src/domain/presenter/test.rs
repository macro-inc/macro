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
fn each_passage_opens_a_message_that_carries_the_steps_after_it() {
    let planned = plan_messages(&[
        prose(0, Some("Checking first.")),
        activity(1, true, 2),
        prose(2, Some("Found it.")),
        activity(3, false, 1),
    ]);
    assert_eq!(planned.len(), 2);
    assert_eq!(indices(&planned[0]), [0, 1]);
    assert_eq!(indices(&planned[1]), [2, 3]);
    assert!(planned.iter().all(|message| message.ready));
}

#[test]
fn steps_before_any_passage_are_a_message_of_their_own_ready_at_once() {
    let planned = plan_messages(&[activity(0, false, 1)]);
    assert_eq!(planned.len(), 1);
    assert!(planned[0].ready);
}

#[test]
fn a_passage_still_being_written_waits_but_keeps_its_place() {
    let planned = plan_messages(&[
        prose(0, Some("Narration.")),
        activity(1, true, 1),
        prose(2, None),
    ]);
    assert_eq!(planned.len(), 2);
    assert!(planned[0].ready);
    assert!(
        !planned[1].ready,
        "an unfinished passage streams live instead"
    );
}

#[test]
fn requests_for_the_user_belong_to_no_message() {
    let planned = plan_messages(&[
        prose(0, Some("May I?")),
        interaction(1),
        activity(2, true, 1),
    ]);
    assert_eq!(planned.len(), 1);
    assert_eq!(indices(&planned[0]), [0, 2]);
}

#[test]
fn a_growing_reply_never_renumbers_its_earlier_messages() {
    let early = plan_messages(&[prose(0, Some("A.")), activity(1, false, 1)]);
    let later = plan_messages(&[
        prose(0, Some("A.")),
        activity(1, true, 3),
        prose(2, Some("B.")),
    ]);
    assert_eq!(indices(&early[0]), indices(&later[0]));
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
