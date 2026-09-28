use super::completion_model_id;
use crate::model::types::Model;

#[test]
fn fireworks_short_name_becomes_the_account_path() {
    let model = Model::try_from("fireworks/kimi-k3").expect("routable id");
    assert_eq!(
        completion_model_id(&model),
        "accounts/fireworks/models/kimi-k3"
    );
}

#[test]
fn fireworks_account_path_is_sent_verbatim() {
    let model = Model::try_from("fireworks/accounts/fireworks/models/kimi-k3")
        .expect("full path is still one provider segment");
    assert_eq!(
        completion_model_id(&model),
        "accounts/fireworks/models/kimi-k3"
    );
}

#[test]
fn other_compatible_providers_keep_the_catalog_name() {
    let model = Model::try_from("cerebras/gpt-oss-120b").expect("routable id");
    assert_eq!(completion_model_id(&model), "gpt-oss-120b");

    let gemini = Model::try_from("google/gemini-3.8-flash").expect("routable id");
    assert_eq!(completion_model_id(&gemini), "gemini-3.8-flash");
}
