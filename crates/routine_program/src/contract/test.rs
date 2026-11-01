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
    let mut found = Vec::new();
    crate::model::visit(&program.steps, &mut |step| match step {
        Step::Code(step) => found.push(
            step.id
                .as_ref()
                .map(|id| id.to_string())
                .unwrap_or_default(),
        ),
        Step::Tool(step) => found.push(
            step.id
                .as_ref()
                .map(|id| id.to_string())
                .unwrap_or_default(),
        ),
        _ => {}
    });
    found
}

#[test]
fn steps_get_ids_from_their_titles_unique_in_the_routine() {
    let mut routine = program(json!([
        code("Filter Important Notifications!", None),
        code("filter important notifications", None),
        { "type": "tool", "tool": "CreateDocument", "arguments": {} },
        code("2nd pass", Some("kept")),
        { "type": "if", "condition": "Urgent?", "then": [
            { "type": "tool", "tool": "SendChannelMessage", "arguments": {} }
        ] },
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
fn each_code_step_sees_the_outputs_that_always_come_before_it() {
    let mut routine = program(json!([
        code("Read", Some("read")),
        { "type": "tool", "id": "task", "tool": "CreateDocument", "arguments": {} },
        { "type": "if", "condition": "Urgent?", "then": [
            code("Inside", Some("inside")),
            code("After inside", None),
        ] },
        code("Last", None),
    ]));
    routine.assign_step_ids();
    let files = routine.check_files();
    let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, ["step_0.ts", "step_1.ts", "step_2.ts", "step_3.ts"]);
    let context = |file: &CheckFile| file.source.lines().last().unwrap().to_owned();
    assert_eq!(
        context(&files[0]),
        "type StepContext = RoutineStepContext<{  }>;"
    );
    assert_eq!(
        context(&files[2]),
        "type StepContext = RoutineStepContext<{ read: StepOutput<Awaited<ReturnType<typeof import('./step_0.ts')['main']>>>; task: RoutineToolOutput<'CreateDocument'>; inside: StepOutput<Awaited<ReturnType<typeof import('./step_1.ts')['main']>>> }>;"
    );
    // A branch's outputs stay in the branch.
    assert!(!context(&files[3]).contains("inside"));
    assert!(context(&files[3]).contains("read:"));
    assert_eq!(files[3].title, "Last");
    // The source's own lines come first, unchanged.
    assert!(
        files[0]
            .source
            .starts_with("export async function main() {}\n")
    );
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
