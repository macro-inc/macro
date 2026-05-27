use super::list_team_members::ListTeamMembers;
use ai_toolset::generate_tool_input_schema;
use ai_toolset::tool_object::validate_tool_schema;

#[test]
fn test_list_team_members_schema_validation() {
    let schema = generate_tool_input_schema!(ListTeamMembers);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ListTeamMembers",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("List"),
        "Description should contain expected text"
    );
}
