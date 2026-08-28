//! Commands and values used by the harness domain.

use agent_client_protocol::schema::v1::{HttpHeader, McpServer as AcpMcpServer, McpServerHttp};
use agent_egress::domain::model::McpServerSlug;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::model::{AgentSessionId, MessageId, SandboxSize};
use agent_session::domain::ports::ControlEvent;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
/// Where a mention happened.
#[derive(Debug, Clone)]
pub struct MentionOrigin {
    /// Channel the mentioning message was posted in.
    pub channel_id: Uuid,
    /// Thread the announcement replies into: the mention's thread root.
    pub thread_id: Uuid,
    /// The mentioning message itself.
    pub message_id: Uuid,
    /// Who asked. Owns the session and is credited for its messages.
    pub sender: MacroUserIdStr<'static>,
    /// The message text, verbatim; becomes the session's first prompt.
    pub content: String,
}

/// Open a new session for a mention.
///
/// Only for managed sessions - the ones whose sandbox this deployment
/// provisions. External sessions are opened through
/// [`agent_session::domain::ports::SessionOpener`] instead: they
/// need no provisioning, no announcement, and no first prompt, so they are
/// a plain create rather than a harness command.
#[derive(Debug, Clone)]
pub struct OpenSession {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The mention itself.
    pub origin: MentionOrigin,
}

/// How a bot's sessions get a runtime — the closed set of first-party
/// providers, one name per member.
///
/// Derived from the bot rather than stored anywhere: the bot id is the
/// durable fact (on trigger events and session rows), and the kind is a pure
/// function of it, so deriving at each decision site is what keeps the two
/// from drifting. Matching on it is exhaustive on purpose — a new
/// provider becomes a compile error at every decision site instead of a
/// silently wrong `else`. This becomes a bot attribute the day the set
/// stops being closed.
///
/// A session's instructions are stored on its row whichever kind serves it,
/// but only [`Self::InMemory`] reads them today - it builds its system prompt
/// in this process, so there is nothing to transport. The rest need one, and
/// ACP supplies none: `session/new` carries a working directory, MCP servers
/// and `_meta`, and nothing else. [`Self::SandboxedCoder`] will get a
/// per-session file listed alongside `SYSTEM.md` in `container/opencode.json`,
/// [`Self::External`] `_meta` on `session/new` for macrod to translate, and
/// [`Self::Cursor`] - whose API takes a prompt and nothing more - has to fold
/// them into the prompt body's hidden agent-context node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    /// A sandbox this deployment provisions (Daytona, or local Docker when
    /// a developer has opted in).
    SandboxedCoder,
    /// A Cursor cloud agent, served over an in-process ACP pipe.
    Cursor,
    /// The in-process (in-memory) Macro bot, served by `agent_inmem`.
    InMemory,
    /// The bot's operator hosts the runtime and dials the gateway; no
    /// deployment here provisions anything for it.
    External,
}

impl AgentKind {
    /// The kind of runtime serving `bot`'s sessions.
    #[must_use]
    pub fn of(bot: BotId) -> Self {
        if bot == bot_id::MACRO_CODER_BOT_ID {
            Self::SandboxedCoder
        } else if bot == bot_id::CURSOR_BOT_ID {
            Self::Cursor
        } else if bot == bot_id::MACRO_AI_BOT_ID {
            Self::InMemory
        } else {
            Self::External
        }
    }

    /// Whether a deployment provisions this kind's runtimes itself.
    ///
    /// Membership is about who provisions, not whether *this* deployment is
    /// armed to — an unarmed deployment refuses a managed bot's sessions
    /// rather than waiting for a dial-in that can never come.
    #[must_use]
    pub fn is_managed(self) -> bool {
        !matches!(self, Self::External)
    }
}

/// Whether a user belongs to the Macro staff domain - the egress crate's
/// predicate, reused so the harness's staff gates and the proxy's can never
/// disagree about who staff is.
pub(crate) use agent_egress::domain::model::is_macro_staff;

/// Where a prompt came from, when it came from somewhere the session should
/// answer back into.
#[derive(Debug, Clone)]
pub struct AnnounceOrigin {
    /// Channel the prompt was posted in.
    pub channel_id: Uuid,
    /// Thread the announcement replies into.
    pub thread_id: Uuid,
    /// The channel message that triggered the prompt.
    pub message_id: Uuid,
}

/// One channel message supplied as untrusted prompt context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriorChannelMessage {
    /// Sender identifier as represented by the channels service.
    pub sender: String,
    /// Message body.
    pub content: String,
}

/// Do something in a session that already exists.
#[derive(Debug, Clone)]
pub struct DeliverAction {
    /// The id the action carries onto the wire, minted when it was accepted.
    /// A reconnect-and-retry resends under the same id.
    pub id: AgentActionId,
    /// What the agent is being asked to do.
    pub action: AgentAction,
    /// The user responsible, absent when nobody in particular is.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Where to announce this, for prompts that arrived from elsewhere.
    ///
    /// `None` means "do not announce": either the caller drove the session
    /// directly, so there is nowhere else to answer, or the action is not the
    /// kind anyone announces. A prompt posted into the session's own dedicated
    /// channel passes `Some`, and is still suppressed - the harness only
    /// learns the session's channel when it runs.
    pub announce: Option<AnnounceOrigin>,
}

/// One operation executed by the harness for an agent session.
///
/// Create, act, destroy. Everything that happens *within* a session's life is
/// a [`DeliverAction`], because the differences that used to justify separate
/// commands - whether to reconnect a dead session, whether to announce - are
/// properties of the action and its origin, not of the request that carried
/// it.
#[derive(Debug, Clone)]
pub enum HarnessCommand {
    /// Open a new session.
    Open(OpenSession),
    /// Act on a session that already exists.
    Deliver(DeliverAction),
    /// Change the session's sandbox size and the owner's default.
    SetSandboxSize(SandboxSize),
    /// Release a session's live resources and delete it.
    Delete,
}

impl DeliverAction {
    /// A prompt from a user, arriving from a channel that may need answering.
    pub fn prompt(
        content: impl Into<String>,
        actor: Option<MacroUserIdStr<'static>>,
        announce: Option<AnnounceOrigin>,
    ) -> Self {
        Self {
            id: AgentActionId::mint(),
            action: AgentAction::prompt(content),
            actor,
            announce,
        }
    }

    /// A control request under a caller-visible id. Names no origin: control
    /// is "deliver this to the session", and announcing a prompt into its
    /// channel is the trigger pipeline's job, keyed on what it observed
    /// rather than anything a caller claims.
    pub fn control(id: AgentActionId, event: ControlEvent) -> Self {
        Self {
            id,
            action: event.action,
            actor: event.actor,
            announce: None,
        }
    }
}

/// Announce a prompt an external runtime delivers itself.
///
/// For a mention in an external session's thread, the trigger pipeline fans
/// out twice: the bot's runtime gets the webhook and sends the prompt through
/// the control endpoint, and this posts the magic-chip message the replies
/// render into. Split that way because each side is the only one that can
/// do its half honestly: only the runtime can reach its harness, and only
/// the observed trigger event can vouch for the channel context.
#[derive(Debug, Clone)]
pub struct AnnouncePrompt {
    /// The bot the trigger named; must match the session row before posting.
    pub bot_id: BotId,
    /// Where the mention was posted.
    pub origin: AnnounceOrigin,
    /// The mention's text, quoted in the announcement.
    pub content: String,
    /// Who mentioned the bot.
    pub sender: MacroUserIdStr<'static>,
}

/// Facts required to announce one prompt into its originating context.
#[derive(Debug, Clone)]
pub struct SessionAnnouncement {
    /// Agent session represented by the announcement.
    pub session_id: AgentSessionId,
    /// The bot the session runs for; the announcement posts as it.
    pub bot_id: BotId,
    /// Channel containing the mention that opened the session.
    pub origin_channel_id: Uuid,
    /// Thread where the announcement should be posted.
    pub origin_thread_id: Uuid,
    /// Folded user message that prompts the anchored agent response.
    pub prompted_message_id: MessageId,
    /// Text of the prompting message, quoted back in the announcement.
    pub prompted_content: String,
    /// User whose mention triggered the announcement.
    pub triggered_by: MacroUserIdStr<'static>,
}

/// Values required to provision a new session container.
#[derive(Debug, Clone)]
pub struct SpawnContainer {
    /// Session that will own the container transport.
    pub session_id: AgentSessionId,
    /// Which provider serves this session — the routing decision itself,
    /// resolved by the emitter from the session's bot. Routing is the only
    /// thing spawn ever consumed the bot for; resume and teardown re-derive
    /// the same kind from the session row's bot.
    pub kind: AgentKind,
    /// Compute tier to request from the provider.
    pub size: SandboxSize,
    /// How the sandbox reaches anything outside itself.
    ///
    /// Carries the repository implicitly: the sandbox clones from the proxy,
    /// which reads the repository off the session's own grant, so no provider
    /// needs to be told what it is.
    pub egress: SandboxEgress,
}

/// Everything a sandbox needs to make an authenticated outbound call, and
/// nothing more.
///
/// The sandbox runs model-authored code with every permission allowed, so
/// whatever is in here has been handed to the model. That is why it is one
/// short-lived session token and a URL rather than any upstream credential:
/// the credentials stay in the egress proxy, which stamps them on as requests
/// pass through.
///
/// The MCP servers are carried as data rather than any provider's rendered
/// config, because two consumers speak two dialects of it: an ACP agent gets
/// them in `session/new` through [`SandboxEgress::acp_servers`], and a Cursor
/// cloud agent gets the same servers through Cursor's own API. One source,
/// two renderings, nothing to drift.
#[derive(Clone)]
pub struct SandboxEgress {
    /// Base URL of the egress proxy, as the sandbox should dial it.
    pub base_url: String,
    /// The session token, presented on every proxied call.
    pub session_token: String,
    /// The owner's connected MCP servers, by the slug the proxy resolves.
    /// Macro's own server is not listed: every session has it, on its own
    /// route.
    pub mcp_servers: Vec<McpServerSlug>,
}

/// Where the sandbox finds the egress proxy.
///
/// Named here rather than written inline because the name is shared knowledge
/// with the container: `container/ensure_ready.sh` reads it to build the git
/// remote it clones from. Like `provision::SIDECAR_PORT`, the agreement between
/// the two is held by a test rather than by comment.
pub const EGRESS_URL_VARIABLE: &str = "MACRO_EGRESS_URL";

/// The session token the sandbox presents on every proxied call. Shared with
/// `container/ensure_ready.sh` on the same terms as [`EGRESS_URL_VARIABLE`].
pub const SESSION_TOKEN_VARIABLE: &str = "MACRO_SESSION_TOKEN";

/// The name every session's server list gives Macro's own MCP server.
///
/// Purely a display name now - resolution happens by route, not by name - but
/// kept short and stable because agents namespace tool names under it.
pub const MACRO_MCP_NAME: &str = "macro";

impl SandboxEgress {
    /// Where the proxy serves `slug` - the URL a client dials to reach that
    /// server, whichever client it is.
    pub fn mcp_url(&self, slug: &McpServerSlug) -> String {
        format!("{}/mcp/{slug}", self.base_url)
    }

    /// Where the proxy serves Macro's own MCP server: its own route, so no
    /// connected app's slug can ever name it.
    pub fn macro_mcp_url(&self) -> String {
        format!("{}/mcp-macro", self.base_url)
    }

    /// The `Authorization` value presented on every proxied call.
    pub fn authorization_header(&self) -> String {
        format!("Bearer {}", self.session_token)
    }

    /// The sandbox environment this becomes.
    ///
    /// Unsized on purpose: a third variable should be one more line here and
    /// nothing at any call site.
    pub fn environment(&self) -> impl IntoIterator<Item = (String, String)> {
        [
            (EGRESS_URL_VARIABLE.to_owned(), self.base_url.clone()),
            (
                SESSION_TOKEN_VARIABLE.to_owned(),
                self.session_token.clone(),
            ),
        ]
    }

    /// Every server the session may dial, as `(name, url)` pairs: Macro's own
    /// server first, then the owner's connected apps under their Pipedream
    /// slugs.
    ///
    /// The one enumeration behind both renderings - [`Self::acp_servers`] and
    /// the Cursor API's - so the two can never advertise different sets.
    pub fn server_entries(&self) -> impl Iterator<Item = (String, String)> + '_ {
        std::iter::once((MACRO_MCP_NAME.to_owned(), self.macro_mcp_url())).chain(
            self.mcp_servers
                .iter()
                .map(|slug| (slug.as_str().to_owned(), self.mcp_url(slug))),
        )
    }

    /// The MCP servers an ACP agent is handed in `session/new`, `session/load`
    /// and `session/resume`.
    ///
    /// Every server is HTTP transport pointed at the egress proxy, never at
    /// the server itself, and carries the session token - the sandbox holds
    /// no upstream credential to point anywhere with.
    pub fn acp_servers(&self) -> Vec<AcpMcpServer> {
        self.server_entries()
            .map(|(name, url)| {
                AcpMcpServer::Http(McpServerHttp::new(name, url).headers(vec![HttpHeader::new(
                    "Authorization",
                    self.authorization_header(),
                )]))
            })
            .collect()
    }
}

/// A minted egress environment and the hash that has to be stored for it to
/// work.
///
/// The two halves go to different places and must not be confused: the raw
/// token in [`ProvisionedEgress::sandbox`] is handed to the container, and
/// [`ProvisionedEgress::session_token_hash`] is what the session row keeps so
/// the proxy can recognize it. Returned together because the row has to be
/// written before the container that holds the token exists.
#[derive(Debug, Clone)]
pub struct ProvisionedEgress {
    /// SHA-256 hex of the session token, for the session row.
    pub session_token_hash: String,
    /// The environment the sandbox is spawned with, carrying the raw token.
    pub sandbox: SandboxEgress,
}

impl std::fmt::Debug for SandboxEgress {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SandboxEgress")
            .field("base_url", &self.base_url)
            .field("session_token", &"[REDACTED]")
            .field("mcp_servers", &self.mcp_servers)
            .finish()
    }
}

/// Session-row values that remain deployment configuration for now.
#[derive(Debug, Clone)]
pub struct SessionDefaults {
    /// The bot managed sessions run as.
    ///
    /// Configuration rather than a constant for the same reason as the
    /// trigger path's: `@claude` and `@codex` are separate deployments of one
    /// binary, differing only in the bot they answer for.
    pub bot_id: BotId,
    /// Model slug, e.g. `claude`.
    pub model: String,
    /// Harness slug, e.g. `opencode`.
    pub harness: String,
    /// Repository sessions run against.
    pub repo_url: String,
}

/// Session defaults for every bot a deployment answers for.
///
/// One deployment can serve more than one managed bot (the sandboxed coder
/// bot and the in-process Macro bot), and each stamps different defaults onto
/// the sessions it opens.
#[derive(Debug, Clone)]
pub struct HarnessDefaults {
    default: SessionDefaults,
    per_bot: Vec<(BotId, SessionDefaults)>,
    managed_bot: Option<BotId>,
}

impl HarnessDefaults {
    /// Defaults every bot shares until one is given its own.
    #[must_use]
    pub fn new(default: SessionDefaults) -> Self {
        Self {
            default,
            per_bot: Vec::new(),
            managed_bot: None,
        }
    }

    /// Stamp `bot`'s sessions with `defaults` instead of the shared ones.
    #[must_use]
    pub fn with_bot(mut self, bot: BotId, defaults: SessionDefaults) -> Self {
        self.per_bot.push((bot, defaults));
        self
    }

    /// Open managed sessions - the ones nothing names a bot for, like the
    /// create menu's - as `bot` instead of the deployment's own.
    #[must_use]
    pub fn with_managed_bot(mut self, bot: BotId) -> Self {
        self.managed_bot = Some(bot);
        self
    }

    /// The defaults a session opens with when no particular bot is named -
    /// the `with_managed_bot` override when one is set, the deployment's own
    /// bot otherwise.
    #[must_use]
    pub fn managed(&self) -> &SessionDefaults {
        match self.managed_bot {
            Some(bot) => self.for_bot(bot),
            None => &self.default,
        }
    }

    /// The defaults `bot`'s sessions are stamped with.
    #[must_use]
    pub fn for_bot(&self, bot: BotId) -> &SessionDefaults {
        self.per_bot
            .iter()
            .find(|(candidate, _)| *candidate == bot)
            .map_or(&self.default, |(_, defaults)| defaults)
    }
}

impl From<SessionDefaults> for HarnessDefaults {
    fn from(default: SessionDefaults) -> Self {
        Self::new(default)
    }
}
