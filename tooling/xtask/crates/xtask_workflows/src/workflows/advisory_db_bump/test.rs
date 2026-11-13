/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn the_bump_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/advisory_db_bump.ts").contains("${{"));
}
