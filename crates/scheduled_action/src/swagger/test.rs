use serde_json::json;
use utoipa::OpenApi;

use super::ApiDoc;

#[test]
fn scheduling_documents_its_responses() {
    let spec = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let responses = spec["paths"]["/scheduled-actions/schedule"]["post"]["responses"]
        .as_object()
        .unwrap();
    assert_eq!(
        responses.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "200", "201", "400", "401", "403", "404", "409", "413", "500"
        ]
    );
    let conflict = responses["409"]["description"].as_str().unwrap();
    for cause in ["active sub-routine limit", "key", "changed or is running"] {
        assert!(conflict.contains(cause), "{conflict}");
    }
}

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
            json!("#/components/schemas/RoutineSubRoutineCopy"),
            json!("#/components/schemas/AgentTask"),
        ]
    );
    assert_eq!(
        schemas["RoutineSubRoutineCopy"]["required"],
        json!(["sub_routine"])
    );

    let program = &schemas["RoutineProgram"];
    assert_eq!(program["required"], json!(["steps"]));
    assert_eq!(
        program["properties"]["sub_routines"]["items"],
        json!({ "$ref": "#/components/schemas/RoutineSubRoutine" })
    );
    assert_eq!(
        program["properties"]["inputs"]["items"],
        json!({ "$ref": "#/components/schemas/RoutineInput" })
    );
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
