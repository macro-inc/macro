use super::*;
use crate::domain::model::{ModelParam, ModelVariant};

fn variant(effort: &str, fast: &str) -> ModelVariant {
    ModelVariant {
        params: vec![
            ModelParam {
                id: "effort".into(),
                value: effort.into(),
            },
            ModelParam {
                id: "fast".into(),
                value: fast.into(),
            },
        ],
        is_default: effort == "low",
    }
}

#[test]
fn advertised_values_preserve_other_parameters_and_remain_opaque() {
    let model = CursorModel {
        id: "cursor-model".into(),
        display_name: "Model".into(),
        variants: vec![
            variant("low", "false"),
            variant("ultra", "false"),
            variant("high", "true"),
        ],
    };
    let current = model.default_choice();
    let options = cursor_session_config_options(&[model], Some(&current));
    let SessionConfigKind::Select(effort) = &options[1].kind else {
        panic!("select");
    };
    let SessionConfigSelectOptions::Ungrouped(values) = &effort.options else {
        panic!("values");
    };
    assert_eq!(
        values
            .iter()
            .map(|option| option.value.to_string())
            .collect::<Vec<_>>(),
        ["low", "ultra"]
    );
    assert_eq!(effort.current_value.to_string(), "low");
}

#[test]
fn no_effort_control_when_only_other_dimensions_can_change() {
    let model = CursorModel {
        id: "cursor-model".into(),
        display_name: "Model".into(),
        variants: vec![variant("low", "false"), variant("high", "true")],
    };
    let current = model.default_choice();
    assert_eq!(
        cursor_session_config_options(&[model], Some(&current)).len(),
        1
    );
    assert!(cursor_session_config_options(&[], None).is_empty());
}
