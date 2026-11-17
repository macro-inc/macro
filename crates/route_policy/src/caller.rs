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
    utoipa::ToSchema,
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
    /// A program held to reads: a routine step's dry run, or a scope this
    /// build doesn't know, signed by a newer one.
    ScopedReadOnly,
    /// Another account's manager credential for this account.
    AccountManager,
    /// A bot.
    Bot,
    /// A computer the person runs agents on.
    Harness,
    /// Another Macro service.
    Internal,
}

impl Caller {
    /// Whether the caller is a program acting with the person's access: an
    /// agent's or routine's run, a scoped session, or another account's
    /// manager. Their refusals of what only the person may do are enforced
    /// from the start.
    pub fn is_program(self) -> bool {
        match self {
            Self::Program
            | Self::ScopedNoSend
            | Self::ScopedGeneration
            | Self::ScopedReadOnly
            | Self::AccountManager => true,
            Self::Person | Self::ApiCredential | Self::Bot | Self::Harness | Self::Internal => {
                false
            }
        }
    }
}
