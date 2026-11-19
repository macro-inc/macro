//! Drafts that may define sub-routines are told how to schedule later work.

use super::*;
use crate::domain::drafts::test::SubRoutinesFor;

#[test]
fn only_a_draft_that_may_define_sub_routines_is_told_how_to_schedule_later_work() {
    let prompts = FindingPrompts::new(&Areas::default());
    let model = "anthropic/claude-sonnet-5-5";

    let told = prompts.instructions(true, true, true, model);
    assert!(told.contains(LATER.trim()));
    assert!(told.contains("macro.routines.schedule('remind_before_due'"));
    // A draft can't give a definition apps, so its work never needs one.
    assert!(told.contains("A sub-routine's steps can't use apps outside Macro"));
    assert!(
        !prompts
            .instructions(true, true, false, model)
            .contains(LATER.trim())
    );
}

#[tokio::test(start_paused = true)]
async fn a_new_routine_defines_sub_routines_only_where_its_owner_may_save_them() {
    let remind = "remind me the day before each task is due";
    let cases = [
        // (owner may define them, code allowed, a new routine, told)
        (Some(true), true, true, true),
        (Some(false), true, true, false),
        (None, true, true, false),
        (Some(true), false, true, false),
        // A step added to a routine is one step, never a definition.
        (Some(true), true, false, false),
    ];
    for (allowed, code, new, told) in cases {
        let model = Arc::new(Model::finding(named(&[])));
        let (drafts, sessions, _) = finding(
            &model,
            &Arc::new(Names::default()),
            Box::new(|_| Vec::new()),
        );
        let drafts = match allowed {
            Some(allowed) => drafts.with_sub_routines(Arc::new(SubRoutinesFor(allowed))),
            None => drafts,
        };
        let request = if new {
            routine(remind)
        } else {
            crate::domain::drafts::test::add(remind, vec![code_step("Make a task", "good")], None)
        };

        drafts
            .draft(owner(), request, DraftContext { code, ..context() })
            .await
            .unwrap();

        let (instructions, _) = briefs(&sessions);
        assert_eq!(
            instructions.unwrap().contains(LATER.trim()),
            told,
            "allowed {allowed:?}, code {code}, new {new}"
        );
    }
}
