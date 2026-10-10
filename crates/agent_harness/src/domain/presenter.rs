//! Which channel messages an agent's reply is shown through, and what each
//! shows.
//!
//! Pure planning over the segments the session's fold reports (see
//! [`agent_fold::domain::model::segments`]). The harness service applies a
//! plan as the reply grows; the announcer chooses the words around the
//! segments and composes their nodes.

use agent_fold::domain::model::{ActivityRow, ActivityStatus, ProjectedSegment, SegmentKind};

#[cfg(test)]
mod test;

/// One message of a reply shown in
/// [`VoiceStyle::Segments`](crate::domain::model::VoiceStyle::Segments): a
/// passage and the steps the agent took after it, or steps alone when the
/// agent got to work before writing anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedMessage {
    /// The segments the message shows, in order.
    pub segments: Vec<ProjectedSegment>,
    /// Whether the message can be posted. One that leads with a passage
    /// waits until the agent has finished writing it - an unfinished passage
    /// streams live instead; one that leads with steps is ready at once.
    pub ready: bool,
}

/// Split a reply into the messages it is shown through.
///
/// A message starts at each passage, so boundaries only ever appear at the
/// end as a reply grows: a reply's n-th message stays its n-th message,
/// which is what lets its id be allocated once and reused. Requests for the
/// user are not part of any message: a pending one is answered live, and an
/// answered one is history the agent's next passage takes up.
#[must_use]
pub fn plan_messages(segments: &[ProjectedSegment]) -> Vec<PlannedMessage> {
    let mut planned: Vec<PlannedMessage> = Vec::new();
    for segment in segments {
        match segment.segment.kind {
            SegmentKind::Interaction => {}
            SegmentKind::Prose => planned.push(PlannedMessage {
                segments: vec![segment.clone()],
                ready: segment.text.is_some(),
            }),
            SegmentKind::Activity => match planned.last_mut() {
                Some(message) => message.segments.push(segment.clone()),
                None => planned.push(PlannedMessage {
                    segments: vec![segment.clone()],
                    ready: true,
                }),
            },
        }
    }
    planned
}

/// The segments a single message showing a whole turn carries: finished
/// passages and every run of steps, in order. An unfinished passage streams
/// live until it is finished.
#[must_use]
pub fn turn_segments(segments: &[ProjectedSegment]) -> Vec<ProjectedSegment> {
    segments
        .iter()
        .filter(|segment| match segment.segment.kind {
            SegmentKind::Prose => segment.text.is_some(),
            SegmentKind::Activity => true,
            SegmentKind::Interaction => false,
        })
        .cloned()
        .collect()
}

/// What a message showing one segment must be rewritten for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentShape {
    index: u32,
    sealed: bool,
    /// A sealed segment's steps and passage; nothing while it is open.
    content: Option<(Vec<ActivityRow>, Option<String>)>,
}

/// What a message showing `segments` must be rewritten for: a segment
/// appearing, a segment sealing, or a sealed segment changing. A step
/// starting or finishing inside an open run of steps is not: viewers who can
/// read the session see it live, and the message's snapshot of the run is
/// rewritten once when it seals. A sealed run can still change - a call held
/// for permission finishes after the request sealed its run, a plan is
/// updated in place - and its message must not keep the old snapshot.
#[must_use]
pub fn shape(segments: &[ProjectedSegment]) -> Vec<SegmentShape> {
    segments
        .iter()
        .map(|segment| SegmentShape {
            index: segment.segment.index,
            sealed: segment.segment.sealed,
            content: segment
                .segment
                .sealed
                .then(|| (segment.segment.rows.clone(), segment.text.clone())),
        })
        .collect()
}

/// A reply as it reads once its turn is over: every segment sealed, and no
/// step still running. The fold closes a turn that ended this way itself;
/// one whose session died, or that recovery finishes, never closed, and a
/// step it left running would spin in its message forever.
#[must_use]
pub fn closed(mut segments: Vec<ProjectedSegment>) -> Vec<ProjectedSegment> {
    for segment in &mut segments {
        segment.segment.sealed = true;
        for row in &mut segment.segment.rows {
            if row.status == ActivityStatus::Running {
                row.status = ActivityStatus::Interrupted;
            }
        }
    }
    segments
}
