use super::*;
use crate::fixture::Fixture;
const PRISM: &str = include_str!(
    "../../../../../../../packages/lexical-conformance/fixtures/upstream/lexical-code-prism/01a0c4dda45b2b49.json"
);

#[test]
fn prism_tab_replays_real_calls_and_requires_its_registration() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    Replayer::default().replay(&fixture)?;
    fixture
        .trace
        .retain(|op| op["name"] != "@lexical/code-prism.registerCodeHighlighting");
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}
#[test]
fn prism_projection_still_checks_text_typing_attributes_and_language() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["json"]["root"]["children"][0]["children"][0]["text"] = json!("wrong");
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["json"]["root"]["children"][0]["language"] = json!("rust");
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["selection"]["format"] = json!(1);
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["selection"]["focus"]["offset"] = json!(42);
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}
#[test]
fn prism_projection_rejects_missing_records_extra_fields_and_wrong_versions() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["nodeMapKeys"]
        .as_array_mut()
        .expect("keys")
        .pop();
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["selection"]["focus"]["extra"] = json!(false);
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["json"]["root"]["children"][0]["children"][0]["version"] = json!(99);
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}

#[test]
fn prism_projection_rejects_contradictory_selection_identities() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["selection"]["anchor"]["key"] = json!("root");
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["selection"]["anchor"]["key"] = json!("1");
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}
#[test]
fn prism_projection_rejects_unknown_and_duplicate_bookkeeping() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.trace[11]["snapshot"]["dirty"]["leaves"]
        .as_array_mut()
        .expect("leaves")
        .push(json!("999999"));
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.trace[11]["snapshot"]["normalized"]
        .as_array_mut()
        .expect("normalized")
        .push(json!("999999"));
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    let entry = fixture.trace[11]["snapshot"]["dirty"]["elements"][0].clone();
    fixture.trace[11]["snapshot"]["dirty"]["elements"]
        .as_array_mut()
        .expect("elements")
        .push(entry);
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}

#[test]
fn prism_projection_validates_raw_map_order_and_canonical_set_members() -> Result<()> {
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["nodeMapKeys"][2] = json!("garbage");
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["nodeMapKeys"][2] = json!("0");
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["nodeMapKeys"]
        .as_array_mut()
        .expect("keys")
        .swap(0, 1);
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.trace[11]["snapshot"]["dirty"]["leaves"]
        .as_array_mut()
        .expect("leaves")
        .push(json!({"$key":99,"raw":"3"}));
    assert!(Replayer::default().replay(&fixture).is_err());
    let mut fixture: Fixture = serde_json::from_str(PRISM)?;
    fixture.r#final["selection"]["anchor"]["key"] = json!({"$key":99,"raw":"4","extra":true});
    assert!(Replayer::default().replay(&fixture).is_err());
    Ok(())
}
