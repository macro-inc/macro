use serde_json::json;
use utoipa::OpenApi;

use super::ApiDoc;

#[test]
fn routine_task_schema_offers_programs_and_single_agent_tasks() {
    let spec = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let schemas = &spec["components"]["schemas"];

    for body in [
        "ActionConfiguration",
        "ActionConfigurationUpdate",
        "ScheduledAction",
    ] {
        assert_eq!(
            schemas[body]["properties"]["task"],
            json!({ "$ref": "#/components/schemas/RoutineTask" }),
            "{body}.task"
        );
    }
    let task_forms: Vec<_> = schemas["RoutineTask"]["oneOf"]
        .as_array()
        .unwrap()
        .iter()
        .map(|form| form["$ref"].clone())
        .collect();
    assert_eq!(
        task_forms,
        vec![
            json!("#/components/schemas/RoutineProgram"),
            json!("#/components/schemas/AgentTask"),
        ]
    );

    let program = &schemas["RoutineProgram"];
    assert_eq!(program["required"], json!(["steps"]));
    assert_eq!(
        program["properties"]["dangerously_operate_as_user"]["type"],
        json!("boolean")
    );
    assert_eq!(
        program["properties"]["steps"]["items"],
        json!({ "$ref": "#/components/schemas/RoutineStep" })
    );
    let step_types: Vec<_> = schemas["RoutineStep"]["oneOf"]
        .as_array()
        .unwrap()
        .iter()
        .map(|variant| variant["allOf"][1]["properties"]["type"]["enum"][0].clone())
        .collect();
    assert_eq!(step_types, vec![json!("code"), json!("agent")]);
}
