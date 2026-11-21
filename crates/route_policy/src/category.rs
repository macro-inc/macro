/// What a route does, at its most sensitive. Every route method declares
/// exactly one, chosen by what it returns or causes, never by its HTTP method:
/// a GET that creates a join code is [`Category::ShareOutside`], and a POST
/// that searches is [`Category::Read`].
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
pub enum Category {
    /// Returns data the caller can already see; changes nothing.
    Read,
    /// The writes a suggestion generation session makes: suggestions,
    /// routine suggestions and email drafts.
    Suggest,
    /// Changes items the caller can already change, telling no one and
    /// granting no one access.
    Write,
    /// Reaches another person: mail, posts, reactions, mentions, calendar
    /// changes guests hear of, booking links.
    Send,
    /// Starts work that runs later with the person's access: routines, agent
    /// sessions and their control, scheduled sends.
    Delegate,
    /// Gives an existing member of the caller's team access to an item, or
    /// adds one to a channel the caller is in.
    ShareMember,
    /// Gives access beyond the team or changes who belongs: link and public
    /// permissions, invite links and join codes, team-wide flips, roles,
    /// templates any user can read.
    ShareOutside,
    /// Returns a bearer credential that outlives the request or works outside
    /// it: API keys, bot tokens, permission tokens, bearer links.
    CredentialMint,
    /// Binds an outside account, device or endpoint to the user, often
    /// completed by whoever holds a link: OAuth links, model keys, MCP
    /// servers, webhooks, push devices, computer pairings.
    Connect,
    /// Changes who can sign in to or control the account: sign-in methods,
    /// account deletion, account managers.
    AuthChange,
    /// Changes or answers a gate that exists so a person decides: review
    /// decisions, tool-call approvals, permission answers, auto-accept and
    /// bypass settings.
    ApprovalGate,
    /// Fetches a caller-chosen outside URL from Macro's servers and returns
    /// what came back.
    Egress,
    /// Service-to-service only.
    Internal,
    /// Takes no Macro credential: OAuth callbacks, signed webhooks, health.
    /// Every caller may reach it, so it protects nothing; declaring it says
    /// the route checks its own proof (a signature, a one-time code).
    Public,
}

impl Category {
    /// What a route of this category does, as the end of "can't …" in a
    /// refusal.
    pub(crate) fn action(self) -> &'static str {
        match self {
            Self::Read => "read this",
            Self::Suggest => "make this suggestion",
            Self::Write => "change items",
            Self::Send => "send to or notify other people",
            Self::Delegate => "start work that runs later",
            Self::ShareMember => "share with team members",
            Self::ShareOutside => "share beyond the team or change who belongs",
            Self::CredentialMint => "create credentials or bearer links",
            Self::Connect => "connect accounts, devices or endpoints",
            Self::AuthChange => "change who can sign in to or control the account",
            Self::ApprovalGate => "approve, answer or change an approval setting",
            Self::Egress => "fetch outside URLs through Macro",
            Self::Internal => "call internal routes",
            Self::Public => "use this route",
        }
    }
}
