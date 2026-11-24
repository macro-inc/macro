//! Model availability for chat, gated by the user's plan.
//!
//! Free (non-professional) users may use only [`FREE_MODEL`]; professional
//! users may use every model in [`CHAT_MODELS`].

/// The chat models offered to users, best-first.
///
/// The current Anthropic generation is Sonnet 5.5, Opus 5.5 and Haiku 5.5;
/// the current OpenAI one is GPT-6 Astra, GPT-6.2 Sol and GPT-6 Luna. A
/// model taken out of this list gets a row in [`RETIRED_MODELS`].
pub const CHAT_MODELS: &[&str] = &[
    "anthropic/claude-sonnet-5-5",
    "anthropic/claude-opus-5-5",
    "anthropic/claude-haiku-5-5",
    "openai/gpt-6-astra",
    "openai/gpt-6.2-sol",
    "openai/gpt-6-luna",
    "google/gemini-3.8-flash",
];

/// Models taken out of [`CHAT_MODELS`], each with the current model of its
/// tier that replaces it wherever it is still selected: a saved agent, a
/// routine, an open session, or a client that has not reloaded since.
pub const RETIRED_MODELS: &[(&str, &str)] = &[
    ("anthropic/claude-haiku-4-5", "anthropic/claude-haiku-5-5"),
    ("openai/gpt-6.1-sol", "openai/gpt-6.2-sol"),
    ("openai/gpt-5.6", "openai/gpt-6.2-sol"),
    ("openai/gpt-5.5", "openai/gpt-6.2-sol"),
    ("openai/gpt-5.6-mini", "openai/gpt-6-luna"),
    ("openai/gpt-5-mini", "openai/gpt-6-luna"),
];

/// The model a selection runs on: a retired model's replacement, otherwise
/// the selected `provider/model` id itself.
#[must_use]
pub fn current_model(model: &str) -> &str {
    RETIRED_MODELS
        .iter()
        .find_map(|(retired, replacement)| (*retired == model).then_some(*replacement))
        .unwrap_or(model)
}

/// The default model for professional (paid) users.
pub const PAID_DEFAULT_MODEL: &str = "anthropic/claude-sonnet-5-5";

/// The only model available to free (non-professional) users.
pub const FREE_MODEL: &str = "google/gemini-3.8-flash";

/// OpenAPI schema publishing [`FREE_MODEL`] as a string enum, so the web
/// client generates its free-tier model list from this crate instead of
/// copying the id.
pub struct FreeTierModel;

impl utoipa::ToSchema for FreeTierModel {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("FreeTierModel")
    }
}

impl utoipa::PartialSchema for FreeTierModel {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::schema::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::String)
            .enum_values(Some([FREE_MODEL]))
            .description(Some(
                "A `provider/model` id every user may request without professional features.",
            ))
            .into()
    }
}
