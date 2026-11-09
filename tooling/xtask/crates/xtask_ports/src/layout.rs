//! Where an instance's ports and subnets sit: the fixed ports of the default
//! instance, the windows named instances get, and the subnet block layout.

use strum::{EnumIter, IntoEnumIterator};

#[cfg(test)]
mod test;

/// The default instance's name. It binds the fixed ports, the discriminants of
/// [`Port`], rather than a window.
pub const DEFAULT_INSTANCE: &str = "macro";

/// Start of the named-instance port windows. The whole range stays below
/// Linux's default ephemeral range (32768-60999), otherwise an ordinary
/// outbound connection can intermittently occupy a Compose host port.
pub const WINDOW_START: u32 = 20_000;
/// Distance between window bases.
pub const STRIDE: u32 = 100;
/// Number of windows: 20000..=31999.
pub const BUCKETS: u32 = 120;

/// The ports one window reserves. Wider than the allocated offsets to leave room
/// for what's conventionally added by hand, `tailscale serve` on proxy port + 40.
pub const WINDOW_WIDTH: u16 = 50;

/// Instance subnets are `10.254.<block>.0/24`, split into one `/26` per network.
pub const SUBNET_PREFIX: &str = "10.254";
/// Addresses per network inside a block.
pub const NETWORK_BLOCK_SIZE: usize = 64;
pub(crate) const SUBNET_BLOCKS: u32 = 256;

/// Every host port a local stack binds. The discriminant IS the port the
/// default `macro` instance binds (matching the values hardcoded in the compose
/// files); a named instance binds `port_base + offset`, where `offset` is the
/// variant's position in declaration order. Adding a port is a single line,
/// appended: `NewThing = 8099,`. Offsets stay below [`WINDOW_WIDTH`], so named
/// windows never overlap.
#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter)]
#[repr(u16)]
pub enum Port {
    /// The app database.
    Postgres = 5432,
    /// Redis.
    Redis = 6379,
    /// Redis Insight.
    RedisUi = 8001,
    /// OpenSearch's REST API.
    OpenSearch = 9200,
    /// OpenSearch's performance analyzer.
    OpenSearchPa = 9600,
    /// FusionAuth.
    FusionAuth = 9011,
    /// LocalStack's edge port.
    LocalStack = 4566,
    /// Mailpit's SMTP listener.
    MailpitSmtp = 1025,
    /// Mailpit's web UI.
    MailpitUi = 8025,
    /// The local HTTPS proxy in front of every service.
    Proxy = 8090,
    /// The frontend dev server.
    Frontend = 3000,
    /// `authentication_service`.
    Auth = 8080,
    /// `connection_gateway`.
    ConnGateway = 8082,
    /// `contacts_service`.
    Contacts = 8083,
    /// No longer bound (see [`Port::is_bound`]); kept in place because offsets
    /// come from declaration order.
    DocCognition = 8085,
    /// `document_storage_service`.
    DocStorage = 8086,
    /// `email_service`.
    Email = 8087,
    /// `notification_service`.
    Notification = 8089,
    /// `search_processing_service`.
    SearchProcessing = 8092,
    /// `static_file_service`.
    StaticFile = 8094,
    /// `unfurl_service`.
    Unfurl = 8095,
    /// `image_proxy_service`.
    ImageProxy = 8097,
    /// The Kafka broker.
    Kafka = 9092,
    /// The SDK webhook relay's SSH listener.
    SdkWebhookSsh = 8788,
    /// The host-side receiver the SDK webhook relay forwards to.
    SdkWebhookHostReceiver = 8789,
    // Appended (not slotted by number) so existing per-instance port offsets,
    // which come from declaration order, stay stable.
    /// Retired with agent_proxy_service; kept (in place, at the end) because
    /// per-instance port offsets come from declaration order, and removing a
    /// variant would shift every one declared after it.
    AgentProxy = 8091,
    /// Agent session control API.
    AgentHarness = 8101,
    /// The agent egress proxy, `agent_harness_service`'s second listener.
    /// Published on every local instance - it is what the Cursor egress
    /// tunnel points at, and Cursor's cloud is outside the compose network.
    AgentHarnessEgress = 8102,
    /// Scheduled actions API and dispatcher (default compose port 8099).
    ScheduledAction = 8099,
    /// Calendar service API (default compose port 8088). Appended at the end so
    /// existing per-instance port offsets, which come from declaration order,
    /// stay stable.
    Calendar = 8088,
    /// Live-preview control API. Appended after Calendar for the same reason.
    PreviewControl = 8110,
    /// Stock SSH reverse-tunnel listener.
    PreviewSsh = 2222,
    /// Local wildcard preview TLS listener.
    PreviewHttps = 8443,
    /// Local-only plaintext gateway reachable from Macro computers.
    ComputerGateway = 8112,
}

impl Port {
    /// The port the default `macro` instance binds — the variant's discriminant.
    pub const fn fixed(self) -> u16 {
        self as u16
    }

    /// The per-port offset within a named instance's window: the variant's
    /// position in declaration order. Unique and `< WINDOW_WIDTH` by
    /// construction (there are far fewer variants than the width).
    pub fn offset(self) -> u16 {
        Port::iter()
            .position(|p| p == self)
            .expect("every Port is yielded by iter()") as u16
    }

    /// Every allocated port — used by doctor / collision probing / the env
    /// summary.
    pub fn all() -> impl Iterator<Item = Port> {
        Port::iter()
    }

    /// Whether anything still listens on this port. Retired variants keep their
    /// offset, but something else on their port doesn't stop a stack starting.
    pub fn is_bound(self) -> bool {
        !matches!(
            self,
            Port::AgentProxy | Port::DocCognition | Port::PreviewControl
        )
    }
}

/// The window a name hashes to. FNV-1a is stable across machines and Rust
/// versions (unlike `DefaultHasher`), so two developers running
/// `--instance agent-a` get the same ports when nothing is in the way.
pub fn hashed_window(name: &str) -> u16 {
    window_base(fnv1a(name) % BUCKETS)
}

/// Every window, starting at the one `name` hashes to.
pub(crate) fn windows_from(name: &str) -> impl Iterator<Item = u16> {
    let start = fnv1a(name) % BUCKETS;
    (0..BUCKETS).map(move |step| window_base((start + step) % BUCKETS))
}

fn window_base(bucket: u32) -> u16 {
    (WINDOW_START + bucket * STRIDE) as u16
}

/// Whether two windows share a port.
pub(crate) fn windows_overlap(left: u16, right: u16) -> bool {
    u32::from(left) < u32::from(right) + u32::from(WINDOW_WIDTH)
        && u32::from(right) < u32::from(left) + u32::from(WINDOW_WIDTH)
}

/// Every subnet block, starting at the one `name` hashes to.
pub(crate) fn blocks_from(name: &str) -> impl Iterator<Item = u8> {
    let start = fnv1a(name) % SUBNET_BLOCKS;
    (0..SUBNET_BLOCKS).map(move |step| ((start + step) % SUBNET_BLOCKS) as u8)
}

/// The subnet of an instance's `index`th network in `block`: networks are
/// carved from the block in order, one `/26` each.
pub fn network_subnet(block: u8, index: usize) -> String {
    format!("{SUBNET_PREFIX}.{block}.{}/26", index * NETWORK_BLOCK_SIZE)
}

pub(crate) fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}
