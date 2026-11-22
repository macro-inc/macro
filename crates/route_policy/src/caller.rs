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
    /// attribution: a Macro API token that verifies and signs no agent,
    /// routine or scope, or a verified user's request carrying a user API
    /// key header (which only narrows it).
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
    /// A program in a routine step's dry run: it reads, by declared category
    /// (a search sent as a POST is a read), and changes nothing.
    ScopedDryRun,
    /// A program held to a scope this build doesn't know, signed by a newer
    /// one: it only reads, and only by method, as `agent_correlation`'s scope
    /// holds it, so a POST is refused even on a read route.
    ScopedUnknown,
    /// A program answering a channel mention: held to what a run that sends
    /// nothing may do (no sends, no egress). Never `Program`, which may send.
    ChannelMention,
    /// Another account's manager credential for this account.
    AccountManager,
    /// A bot. The agent resolver gives it only to a verified user's request
    /// that carries a bot header, which narrows it; the bot's own extractor
    /// verifies the token.
    Bot,
    /// A computer the person runs agents on. Resolved like [`Self::Bot`].
    Harness,
    /// Another Macro service. No resolver here gives it: an internal key is
    /// verified by the route's own extractor, and a header alone resolves no
    /// caller.
    Internal,
}

impl Caller {
    /// Whether the caller is a program acting with the person's access: an
    /// agent's or routine's run, a scoped session, a channel mention, or
    /// another account's manager. Their refusals of what only the person may
    /// do are enforced from the start.
    pub fn is_program(self) -> bool {
        match self {
            Self::Program
            | Self::ScopedNoSend
            | Self::ScopedGeneration
            | Self::ScopedDryRun
            | Self::ScopedUnknown
            | Self::ChannelMention
            | Self::AccountManager => true,
            Self::Person | Self::ApiCredential | Self::Bot | Self::Harness | Self::Internal => {
                false
            }
        }
    }
}
