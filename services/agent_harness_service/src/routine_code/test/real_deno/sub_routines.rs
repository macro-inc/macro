//! A routine's code schedules its sub-routines, which read their inputs.

use super::*;

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_routine_schedules_its_sub_routines_by_name_with_their_typed_inputs() {
    let (_root, code) = code("http://127.0.0.1:9").await;
    // The routine's step schedules; the sub-routine's step reads its input.
    let routine = |schedule: &str, remind: &str| {
        let mut program = RoutineProgram::from_task(&json!({
            "steps": [{ "type": "code", "title": "Schedule", "source": format!(
                "export async function main({{ macro }}: StepContext) {{ {schedule} }}"
            ) }],
            "sub_routines": [{
                "name": "remind",
                "title": "Remind me",
                "inputs": [{ "type": "text", "name": "taskId", "label": "Task" }],
                "steps": [{ "type": "code", "title": "Remind", "source": format!(
                    "export async function main({{ inputs }}: StepContext) {{ {remind} }}"
                ) }],
            }],
        }))
        .unwrap();
        program.assign_step_ids();
        program
    };
    let schedule = "const copy = await macro.routines.schedule('remind', { trigger: { type: 'once', at: '2030-01-01T09:00:00Z' }, inputs: { taskId: 't' }, key: 'k' }); return copy.id;";
    let read = "const id: string = inputs.taskId; return id;";
    assert_eq!(
        code.check_program(&routine(schedule, read)).await.unwrap(),
        Vec::new()
    );

    for (wrong, expected) in [
        (schedule.replace("'remind'", "'nudge'"), "'\"nudge\"'"),
        (schedule.replace("taskId: 't'", "taskId: 1"), "number"),
        (schedule.replace("taskId: 't'", ""), "taskId"),
    ] {
        let failing = code.check_program(&routine(&wrong, read)).await.unwrap();
        assert_eq!(failing.len(), 1, "{wrong}: {failing:?}");
        assert_eq!(failing[0].index, 0);
        assert!(failing[0].problems[0].contains(expected), "{failing:?}");
    }
    let failing = code
        .check_program(&routine(schedule, "return inputs.dueAt;"))
        .await
        .unwrap();
    assert_eq!(failing.len(), 1, "{failing:?}");
    assert_eq!(
        (failing[0].index, failing[0].title.as_str()),
        (1, "Remind (in sub-routine `remind`)")
    );
    assert!(failing[0].problems[0].contains("Property 'dueAt' does not exist"));
}

/// A name that could be either of two sub-routines takes neither's
/// inputs, so a value fitting one can't reach the other.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_schedule_call_takes_the_inputs_of_the_one_sub_routine_it_names() {
    let (_root, code) = code("http://127.0.0.1:9").await;
    let routine = |body: &str| {
        let mut program = RoutineProgram::from_task(&json!({
            "steps": [{ "type": "code", "title": "Schedule", "source": format!(
                "export async function main({{ macro, run }}: StepContext) {{ const trigger = {{ type: 'once' as const, at: run.at }}; {body} }}"
            ) }],
            "sub_routines": [
                {
                    "name": "remind",
                    "title": "Remind me",
                    "inputs": [{ "type": "text", "name": "taskId", "label": "Task" }],
                    "steps": [{ "type": "agent", "model": "m", "instructions": "Remind me" }],
                },
                {
                    "name": "count",
                    "title": "Count",
                    "inputs": [{ "type": "number", "name": "n", "label": "N" }],
                    "steps": [{ "type": "agent", "model": "m", "instructions": "Count" }],
                },
            ],
        }))
        .unwrap();
        program.assign_step_ids();
        program
    };
    let each = "await macro.routines.schedule('remind', { trigger, inputs: { taskId: 't' } }); await macro.routines.schedule('count', { trigger, inputs: { n: 42 } });";
    assert_eq!(
        code.check_program(&routine(each)).await.unwrap(),
        Vec::new()
    );
    let either = "const name = run.dryRun ? ('remind' as const) : ('count' as const); await macro.routines.schedule(name, { trigger, inputs: { n: 42 } });";
    let failing = code.check_program(&routine(either)).await.unwrap();
    assert_eq!(failing.len(), 1, "{failing:?}");
}

/// `macro` stays the SDK's `Macro`, so a helper typed with it takes it,
/// and stored code that widens it and hands it back as a `StepContext`
/// checks as it did; only a routine that defines sub-routines can call
/// `schedule`.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn macro_stays_the_sdks_and_only_a_routine_with_sub_routines_schedules() {
    let (_root, code) = code("http://127.0.0.1:9").await;
    let step = |body: &str| {
        json!({ "type": "code", "title": "Schedule", "source": format!(
            "import type {{ Macro }} from '@macro-inc/sdk';\n\
             const routines = (macro: Macro) => macro.routines;\n\
             export async function main({{ macro }}: StepContext) {{ routines(macro); {body} }}"
        ) })
    };
    let routine = |body: &str, sub_routines: serde_json::Value| {
        let mut program = RoutineProgram::from_task(&json!({
            "steps": [step(body)],
            "sub_routines": sub_routines,
        }))
        .unwrap();
        program.assign_step_ids();
        program
    };
    let remind = json!([{
        "name": "remind",
        "title": "Remind me",
        "inputs": [{ "type": "text", "name": "taskId", "label": "Task" }],
        "steps": [{ "type": "agent", "model": "m", "instructions": "Remind me" }],
    }]);
    let schedule = "await macro.routines.schedule('remind', { trigger: { type: 'once', at: '2030-01-01T09:00:00Z' }, inputs: { taskId: 't' } });";

    assert_eq!(
        code.check_program(&routine(schedule, remind))
            .await
            .unwrap(),
        Vec::new()
    );
    assert_eq!(
        code.check_program(&routine("", json!([]))).await.unwrap(),
        Vec::new()
    );
    let mut widened = RoutineProgram::from_task(&json!({ "steps": [{
        "type": "code",
        "title": "Widen",
        "source": "import type { Macro } from '@macro-inc/sdk';\n\
                   const inner = (ctx: StepContext) => ctx.run.id;\n\
                   export async function main(ctx: StepContext) { const macro: Macro = ctx.macro; return inner({ ...ctx, macro }); }",
    }] }))
    .unwrap();
    widened.assign_step_ids();
    assert_eq!(code.check_program(&widened).await.unwrap(), Vec::new());
    let failing = code
        .check_program(&routine(schedule, json!([])))
        .await
        .unwrap();
    assert_eq!(failing.len(), 1, "{failing:?}");
    assert!(
        failing[0].problems[0].contains("parameter of type 'never'"),
        "{failing:?}"
    );
}
