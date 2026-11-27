/// Who is making a request, resolved from its verified credential's signed
/// claims. An unsigned header may only narrow it, never widen it.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Hash,
    serde::Serialize,
    strum::Display,
    strum::EnumIter,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Caller {
    /// A person in their own session, with no program attribution.
    Person,
    /// A credential the person holds outside the app with no program
    /// attribution: a user API key, or a Macro API token that signs no agent,
    /// routine or scope.
    ApiCredential,
    /// A program running with the person's access: a token signed for an
    /// agent or a routine, or carrying a validated agent correlation.
    Program,
    /// A program in a background run that may change the person's own items
    /// but reaches no one else.
    ScopedNoSend,
    /// A program in a suggestion generation session: it reads and makes
    /// suggestions.
    ScopedGeneration,
    /// A program held to a scope this build doesn't know, signed by a newer
    /// one: it only reads.
    ScopedUnknown,
    /// Another account's manager credential for this account.
    AccountManager,
    /// A bot.
    Bot,
    /// A computer the person runs agents on.
    Harness,
    /// Another Macro service.
    Internal,
}
