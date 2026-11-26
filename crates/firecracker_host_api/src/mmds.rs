//! The MMDS document the agent serves each guest, read in the guest by
//! `macro-restore` (`nix/macro-box/files/macro-restore`) and
//! `macrod enroll --from mmds`. Its keys are the guest's contract and stay
//! snake_case.
//!
//! ```json
//! {"macro": {"identity": {...}, "enrollment": {...}}}
//! ```
//!
//! The golden boot has neither key: `macro-restore` reads a 404 for the
//! identity as "not a computer yet" and changes nothing.

use serde::{Deserialize, Serialize};

use crate::{ComputerId, ComputerRole, EnrollmentDocument};

/// MMDS as the guest reaches it.
pub const ADDRESS: &str = "http://169.254.169.254";

/// MMDS v2: `PUT` here, with [`TOKEN_TTL_HEADER`], for a session token.
pub const TOKEN_PATH: &str = "/latest/api/token";

/// The session token's lifetime in seconds, on the token request.
pub const TOKEN_TTL_HEADER: &str = "X-metadata-token-ttl-seconds";

/// The session token, on every read.
pub const TOKEN_HEADER: &str = "X-metadata-token";

/// MMDS path of [`Identity`].
pub const IDENTITY_POINTER: &str = "/macro/identity";

/// MMDS path of the enrollment.
pub const ENROLLMENT_POINTER: &str = "/macro/enrollment";

/// The whole document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    /// Everything Macro puts there.
    #[serde(rename = "macro")]
    pub macro_data: MacroData,
}

/// `macro` in [`Document`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MacroData {
    /// Who this guest is.
    pub identity: Identity,
    /// Until macrod has used it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enrollment: Option<EnrollmentDocument>,
}

/// Who a restored guest is. Rewritten before every resume (`time_unix_ms`
/// moves on); `id` stays the computer's, so the guest keeps its machine id
/// across hibernation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    /// The computer; the guest makes a new machine id when it changes.
    pub id: ComputerId,
    /// `person` or `agent`: what the guest grants its `macro` user.
    pub role: ComputerRole,
    /// Host wall clock when the document was written; the guest steps its
    /// clock to it.
    pub time_unix_ms: i64,
    /// The guest's address on its tap.
    pub network: Network,
}

/// The guest's own address beside its link-local MMDS address.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Network {
    /// CIDR, e.g. `172.16.0.2/30`.
    pub address: String,
    /// The tap's host side, e.g. `172.16.0.1`.
    pub gateway: String,
    /// Resolvers.
    pub dns: Vec<String>,
}
