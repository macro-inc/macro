use serde_json::json;

use super::*;

fn program(steps: serde_json::Value) -> RoutineProgram {
    RoutineProgram::from_task(&json!({ "steps": steps })).unwrap()
}

fn code(title: &str, id: Option<&str>) -> serde_json::Value {
    let mut step =
        json!({ "type": "code", "title": title, "source": "export async function main() {}" });
    if let Some(id) = id {
        step["id"] = json!(id);
    }
    step
}

fn ids(program: &RoutineProgram) -> Vec<String> {
    program
        .steps
        .iter()
        .filter_map(|step| match step {
            Step::Code(step) => Some(step.id.as_ref()),
            Step::Agent(_) => None,
        })
        .map(|id| id.map(ToString::to_string).unwrap_or_default())
        .collect()
}

#[test]
fn steps_get_ids_from_their_titles_unique_in_the_routine() {
    let mut routine = program(json!([
        code("Filter Important Notifications!", None),
        code("filter important notifications", None),
        code("Create Document", None),
        code("2nd pass", Some("kept")),
        code("sendChannelMessage", None),
    ]));
    routine.assign_step_ids();
    assert_eq!(
        ids(&routine),
        [
            "filter_important",
            "filter_important_2",
            "create_document",
            "kept",
            "send_channel_message",
        ]
    );
    // Assigning again keeps them.
    let before = routine.clone();
    routine.assign_step_ids();
    assert_eq!(routine, before);
}

#[test]
fn each_code_step_sees_the_outputs_of_the_steps_before_it() {
    let mut routine = program(json!([
        code("Read", Some("read")),
        { "type": "agent", "model": "m", "instructions": "Summarize" },
        code("Last", None),
    ]));
    routine.assign_step_ids();
    let files = routine.check_files();
    let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, ["step_0.ts", "step_1.ts"]);
    // The context's type, then the check that `main` takes it.
    let context = |file: &CheckFile| file.source.lines().rev().nth(1).unwrap().to_owned();
    for file in &files {
        assert_eq!(
            file.source.lines().last().unwrap(),
            format!(
                "(undefined as unknown as typeof import('./{}')['main']) satisfies (context: StepContext) => unknown;",
                file.name
            )
        );
    }
    assert_eq!(
        context(&files[0]),
        "type StepContext = RoutineStepContext<{  }, {  }>;"
    );
    assert_eq!(
        context(&files[1]),
        "type StepContext = RoutineStepContext<{ read: StepOutput<Awaited<ReturnType<typeof import('./step_0.ts')['main']>>> }, {  }>;"
    );
    assert_eq!(files[1].title, "Last");
    // The source's own lines come first, unchanged.
    assert!(
        files[0]
            .source
            .starts_with("export async function main() {}\n")
    );
}

#[test]
fn a_step_sees_its_knobs_typed_but_not_their_values() {
    let with = |priority: &str, days: f64| {
        program(json!([{
            "type": "code",
            "title": "Triage",
            "source": "export async function main({ knobs }: StepContext) { return [knobs.priority, knobs.days, knobs.note, knobs.urgent, knobs.notify]; }",
            "knobs": [
                { "type": "choice", "name": "priority", "label": "Priority", "value": priority, "options": ["Low", "High \"now\""] },
                { "type": "number", "name": "days", "label": "Days", "value": days, "min": 1 },
                { "type": "text", "name": "note", "label": "Note", "value": "Hi" },
                { "type": "question", "name": "urgent", "label": "it's urgent", "value": "Is it urgent?" },
                { "type": "boolean", "name": "notify", "label": "Notify me", "value": true },
            ],
        }]))
    };
    let files = with("Low", 7.0).check_files();
    assert_eq!(
        files[0].source.lines().rev().nth(1).unwrap(),
        r#"type StepContext = RoutineStepContext<{  }, { priority: "Low" | "High \"now\""; days: number; note: string; urgent: string; notify: boolean }>;"#
    );
    // Changing a value changes nothing the checker sees.
    assert_eq!(with(r#"High "now""#, 30.0).check_files(), files);
}

#[test]
fn the_recorded_version_names_the_sdk_and_the_contract() {
    let version = code_version("0.2.2+abc");
    let (sdk, contract) = version.as_str().split_once("+ctx.").unwrap();
    assert_eq!(sdk, "0.2.2+abc");
    assert_eq!(contract.len(), 8);
    assert_eq!(code_version("0.2.2+abc"), version);
    assert_ne!(code_version("0.2.3+def"), version);
}

#[test]
fn a_routines_sub_routines_type_its_schedule_and_their_steps_inputs() {
    let mut routine = RoutineProgram::from_task(&json!({
        "steps": [code("Schedule", None)],
        "sub_routines": [
            {
                "name": "remind",
                "title": "Remind me",
                "inputs": [
                    { "type": "text", "name": "taskId", "label": "Task" },
                    { "type": "boolean", "name": "urgent", "label": "Urgent" },
                ],
                "steps": [code("Schedule", None), code("Tell", None)],
            },
            { "name": "nudge", "title": "Nudge me", "steps": [code("Nudge", None)] },
        ],
    }))
    .unwrap();
    routine.assign_step_ids();
    let files = routine.check_files();

    // Numbered on from the routine's own steps; ids are per run, so a
    // sub-routine's step may reuse a title the routine's own step has.
    let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, ["step_0.ts", "step_1.ts", "step_2.ts", "step_3.ts"]);
    assert_eq!(files[1].title, "Schedule (in sub-routine `remind`)");
    assert_eq!(ids(&routine), ["schedule"]);
    let Step::Code(first) = &routine.sub_routines[0].steps[0] else {
        panic!("a code step");
    };
    assert_eq!(first.id.as_ref().map(StepId::as_str), Some("schedule"));

    let context = |file: &CheckFile| {
        let lines: Vec<&str> = file.source.lines().collect();
        lines[1..lines.len() - 1].join("\n")
    };
    let schedule = |base: &str, inputs: &str| {
        format!(
            "type $SubRoutines = {{ remind: {{ inputs: {{ taskId: string; urgent: boolean }} }}; nudge: {{ inputs?: Record<string, never> }} }};\n\
             type $Macro = {base}['macro'];\n\
             type $Routines = $Macro['routines'];\n\
             type StepContext = Omit<{base}, 'macro'> & {{ macro: Omit<$Macro, 'routines'> & {{ routines: Omit<$Routines, 'schedule'> & {{ schedule<Name extends keyof $SubRoutines>(name: Name, options: Omit<Parameters<$Routines['schedule']>[1], 'inputs'> & $SubRoutines[Name]): ReturnType<$Routines['schedule']> }} }} }}{inputs};"
        )
    };
    assert_eq!(
        context(&files[0]),
        schedule("RoutineStepContext<{  }, {  }>", "")
    );
    // A sub-routine's steps read its inputs, and the outputs of its own
    // steps only.
    assert_eq!(
        context(&files[2]),
        schedule(
            "RoutineStepContext<{ schedule: StepOutput<Awaited<ReturnType<typeof import('./step_1.ts')['main']>>> }, {  }>",
            " & { inputs: { taskId: string; urgent: boolean } }"
        )
    );
    // One without inputs reads none, as a routine without inputs doesn't:
    // made standalone, its code checks as it did.
    assert_eq!(
        context(&files[3]),
        schedule("RoutineStepContext<{  }, {  }>", "")
    );
}
