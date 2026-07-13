use crate::model::types::Model;

#[test]
fn test_from_string() {
    let good = Model::try_from("anthropic/claude-big-burger").expect("good model");
    assert_eq!(good.name(), "claude-big-burger");
    assert_eq!(good.provider(), "anthropic");

    let bad = "claude-big-burger";
    assert!(Model::try_from(bad).is_err());
}
