use agent_client_protocol::schema::v1::{
    SessionConfigGroupId, SessionConfigId, SessionConfigOption, SessionConfigSelectGroup,
    SessionConfigSelectOption,
};

use super::*;

fn option(value: &str, name: &str) -> SessionConfigSelectOption {
    SessionConfigSelectOption::new(value.to_owned(), name.to_owned())
}

#[test]
fn projects_ungrouped_models_and_ignores_other_config() {
    let options = vec![
        SessionConfigOption::boolean(SessionConfigId::new("thinking"), "Thinking", true),
        SessionConfigOption::select(
            SessionConfigId::new(MODEL_CONFIG_ID),
            "Model",
            "sonnet",
            vec![
                option("opus", "Opus").description("Largest model"),
                option("sonnet", "Sonnet"),
            ],
        ),
    ];

    let selection = model_selection(&options).expect("the model select should project");

    assert_eq!(selection.current, "sonnet");
    assert_eq!(
        selection.options,
        vec![
            ModelOption {
                id: "opus".to_owned(),
                name: "Opus".to_owned(),
                description: Some("Largest model".to_owned()),
            },
            ModelOption {
                id: "sonnet".to_owned(),
                name: "Sonnet".to_owned(),
                description: None,
            },
        ]
    );
}

#[test]
fn flattens_grouped_models_in_group_and_option_order() {
    let options = vec![SessionConfigOption::select(
        SessionConfigId::new(MODEL_CONFIG_ID),
        "Model",
        "fast",
        vec![
            SessionConfigSelectGroup::new(
                SessionConfigGroupId::new("anthropic"),
                "Anthropic",
                vec![option("smart", "Smart"), option("fast", "Fast")],
            ),
            SessionConfigSelectGroup::new(
                SessionConfigGroupId::new("openai"),
                "OpenAI",
                vec![option("reasoning", "Reasoning").description("Deep reasoning")],
            ),
        ],
    )];

    let selection = model_selection(&options).expect("the grouped model select should project");

    assert_eq!(selection.current, "fast");
    assert_eq!(
        selection
            .options
            .iter()
            .map(|option| option.id.as_str())
            .collect::<Vec<_>>(),
        vec!["smart", "fast", "reasoning"]
    );
    assert_eq!(
        selection.options[2].description.as_deref(),
        Some("Deep reasoning")
    );
}
