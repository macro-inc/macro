//! Model availability for chat, gated by the user's plan.
//!
//! Free (non-professional) users may use only [`FREE_MODEL`]; professional
//! users may use every model in [`CHAT_MODELS`].

/// The chat models offered to users, best-first.
///
/// The current Anthropic generation is Sonnet 5.5 and Opus 5.5. Haiku 4.5
/// stays as the fast model; older Sonnet, Opus, and Fable ids are absent.
pub const CHAT_MODELS: &[&str] = &[
    "anthropic/claude-sonnet-5-5",
    "anthropic/claude-opus-5-5",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-6-astra",
    "openai/gpt-6.1-sol",
    "openai/gpt-5.6",
    "openai/gpt-5.6-mini",
    "openai/gpt-5.5",
    "openai/gpt-5-mini",
    "google/gemini-3.8-flash",
];

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
