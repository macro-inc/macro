use super::list_team_members::ListTeamMembers;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_list_team_members_schema_validation() {
    let result = generate_validated_input_schema::<ListTeamMembers>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ListTeamMembers",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("List"),
        "Description should contain expected text"
    );
}
