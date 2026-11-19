use serde_json::json;

use crate::{ProgramError, RoutineProgram, RoutineTask, Step, SubRoutineCopy};

/// A routine that schedules `remind` with a task's id and name.
fn parent() -> serde_json::Value {
    json!({
        "steps": [{
            "type": "code",
            "title": "Schedule reminders",
            "source": "export async function main({ macro }: StepContext) {}",
        }],
        "sub_routines": [{
            "name": "remind",
            "title": "Remind me about a task",
            "inputs": [
                { "type": "text", "name": "taskId", "label": "Task" },
                { "type": "number", "name": "daysLeft", "label": "Days left" },
            ],
            "steps": [
                {
                    "type": "code",
                    "title": "Read the task",
                    "source": "export async function main({ inputs }: StepContext) { return inputs.taskId; }",
                },
                { "type": "agent", "model": "m", "instructions": "Tell me about the task." },
            ],
        }],
        "dangerously_operate_as_user": true,
    })
}

fn copy(inputs: serde_json::Value) -> SubRoutineCopy {
    serde_json::from_value(json!({ "sub_routine": "remind", "inputs": inputs })).unwrap()
}

#[test]
fn a_copy_runs_its_definition_with_the_values_it_was_given() {
    let parent = RoutineProgram::from_task(&parent()).unwrap();
    parent.validate().unwrap();

    let program = parent
        .copy_program(&copy(json!({ "taskId": "t-1", "daysLeft": 2 })))
        .unwrap();

    assert_eq!(program.steps.len(), 2);
    assert!(
        matches!(&program.steps[1], Step::Agent(agent) if agent.instructions == "Tell me about the task.")
    );
    assert_eq!(
        serde_json::Value::Object(program.input_values()),
        json!({ "taskId": "t-1", "daysLeft": 2.0 })
    );
    // It never writes as the owner, though its parent does: a run chose its
    // values. It can schedule its parent's sub-routines.
    assert!(parent.dangerously_operate_as_user);
    assert!(!program.dangerously_operate_as_user);
    assert_eq!(program.sub_routines, parent.sub_routines);
    program.validate().unwrap();
}

#[test]
fn a_copy_needs_every_input_its_definition_declares_and_no_other() {
    let parent = RoutineProgram::from_task(&parent()).unwrap();
    let refused = |inputs| parent.copy_program(&copy(inputs)).unwrap_err().to_string();

    assert_eq!(
        refused(json!({ "taskId": "t-1" })),
        "input `daysLeft` needs a value"
    );
    assert_eq!(
        refused(json!({ "taskId": "t-1", "daysLeft": 2, "owner": "x" })),
        "the sub-routine has no input `owner`"
    );
    assert_eq!(
        refused(json!({ "taskId": 7, "daysLeft": 2 })),
        "input `taskId` takes a string"
    );
    assert_eq!(
        refused(json!({ "taskId": "x".repeat(2_001), "daysLeft": 2 })),
        "input `taskId` can be at most 2000 characters"
    );
    // Postgres can't store one in JSONB.
    assert_eq!(
        refused(json!({ "taskId": "t\u{0}1", "daysLeft": 2 })),
        "input `taskId` can't hold a NUL character"
    );
}

#[test]
fn a_copy_of_a_definition_the_parent_no_longer_has_cannot_run() {
    let mut parent = RoutineProgram::from_task(&parent()).unwrap();
    parent.sub_routines.clear();

    let error = parent
        .copy_program(&copy(json!({ "taskId": "t-1", "daysLeft": 2 })))
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "the routine that scheduled this one no longer has a sub-routine named `remind`"
    );
}

#[test]
fn a_copy_is_its_own_task_form_not_a_program() {
    let task = json!({ "sub_routine": "remind", "inputs": { "taskId": "t-1" } });

    assert!(RoutineProgram::from_task(&task).is_err());
    assert_eq!(
        SubRoutineCopy::from_task(&task).map(|copy| copy.task()),
        Some(task.clone())
    );
    assert!(matches!(
        serde_json::from_value::<RoutineTask>(task).unwrap(),
        RoutineTask::Copy(_)
    ));
    assert_eq!(SubRoutineCopy::from_task(&parent()), None);
}

#[test]
fn a_definition_follows_the_rules_a_routine_does() {
    let mut task = parent();
    task["sub_routines"][0]["steps"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "type": "agent", "model": "m", "instructions": "Again." }));

    let error = RoutineProgram::from_task(&task)
        .unwrap()
        .validate()
        .unwrap_err();

    assert_eq!(
        error,
        ProgramError::InSubRoutine {
            name: "remind".to_owned().try_into().unwrap(),
            error: Box::new(ProgramError::TooManyAgents),
        }
    );
    assert_eq!(
        error.to_string(),
        "in sub-routine `remind`: a routine can hand off to at most one agent"
    );
}

#[test]
fn a_definitions_inputs_get_values_only_in_copies() {
    let mut task = parent();
    task["sub_routines"][0]["inputs"][0]["value"] = json!("t-1");
    assert_eq!(
        RoutineProgram::from_task(&task)
            .unwrap()
            .validate()
            .unwrap_err()
            .to_string(),
        "in sub-routine `remind`: input `taskId`: a sub-routine's input gets its value when a copy is scheduled; remove `value`"
    );

    // A routine's own inputs, kept from a copy, hold their values.
    let mut task = parent();
    task["inputs"] = json!([{ "type": "boolean", "name": "urgent", "label": "Urgent" }]);
    assert_eq!(
        RoutineProgram::from_task(&task)
            .unwrap()
            .validate()
            .unwrap_err()
            .to_string(),
        "input `urgent`: a routine's input needs a value"
    );
    task["inputs"][0] =
        json!({ "type": "text", "name": "urgent", "label": "Urgent", "value": "a\u{0}b" });
    assert_eq!(
        RoutineProgram::from_task(&task)
            .unwrap()
            .validate()
            .unwrap_err()
            .to_string(),
        "input `urgent`: text can't hold a NUL character"
    );
}

#[test]
fn sub_routine_names_are_unique_and_bounded() {
    let mut task = parent();
    let definition = task["sub_routines"][0].clone();
    task["sub_routines"] = json!([definition.clone(), definition.clone()]);
    assert_eq!(
        RoutineProgram::from_task(&task)
            .unwrap()
            .validate()
            .unwrap_err(),
        ProgramError::DuplicateSubRoutine("remind".to_owned().try_into().unwrap())
    );

    task["sub_routines"] = json!(
        (0..6)
            .map(|index| {
                let mut definition = definition.clone();
                definition["name"] = json!(format!("remind_{index}"));
                definition
            })
            .collect::<Vec<_>>()
    );
    assert_eq!(
        RoutineProgram::from_task(&task)
            .unwrap()
            .validate()
            .unwrap_err(),
        ProgramError::TooManySubRoutines
    );

    let mut task = parent();
    task["sub_routines"][0]["name"] = json!("Remind");
    assert!(RoutineProgram::from_task(&task).is_err());
}

#[test]
fn code_steps_are_numbered_the_routines_own_first_then_each_sub_routines() {
    let program = RoutineProgram::from_task(&parent()).unwrap();

    let titles: Vec<&str> = program
        .code_steps()
        .into_iter()
        .map(|step| step.title.as_str())
        .collect();
    assert_eq!(titles, ["Schedule reminders", "Read the task"]);
    assert_eq!(program.code_step_place(0), Some((None, 0)));
    assert_eq!(
        program.code_step_place(1),
        Some((Some(&"remind".to_owned().try_into().unwrap()), 0))
    );
    assert_eq!(program.code_step_place(2), None);
}
