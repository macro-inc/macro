use crate::{
    DATABASE_TOOL_USE_PROMPT, DIRECT_TOOL_USE_PROMPT, SESSION_TOOL_USE_PROMPT, TOOL_USE_PROMPT,
    mcp_instructions,
};

#[test]
fn every_agent_host_maps_deal_requests_to_the_pipeline_tools() {
    for text in [
        DIRECT_TOOL_USE_PROMPT.to_string(),
        SESSION_TOOL_USE_PROMPT.to_string(),
        TOOL_USE_PROMPT.to_string(),
        mcp_instructions("https://macro.com"),
    ] {
        for guidance in [
            "ListPipelines",
            "FindPipelineEntries",
            "UpdatePipelineEntries",
            "AddToPipeline",
            "RemoveFromPipeline",
            "EditPipeline",
            "CreatePipeline",
            "not a Macro database",
            "SetEntityProperty",
        ] {
            assert!(
                text.contains(guidance),
                "missing pipeline guidance: {guidance}"
            );
        }
    }
}

#[test]
fn the_database_only_assistant_has_no_pipeline_tools_to_describe() {
    assert!(
        !DATABASE_TOOL_USE_PROMPT
            .to_string()
            .contains("ListPipelines")
    );
}
