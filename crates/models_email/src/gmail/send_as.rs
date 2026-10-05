//! Gmail Settings.sendAs API types.
//!
//! A "send-as" alias allows a Gmail user to send email from an alternative
//! address (e.g. support@company.com) using their main Gmail account.
//! Gmail manages these through the settings.sendAs API.

use serde::{Deserialize, Serialize};

/// Response from `users.settings.sendAs.list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSendAsResponse {
    /// The list of send-as alias configurations.
    #[serde(default)]
    pub send_as: Vec<SendAsResource>,
}

/// A single send-as alias configuration from Gmail.
///
/// See: https://developers.google.com/gmail/api/reference/rest/v1/users.settings.sendAs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAsResource {
    /// The email address that appears in the "From:" header for mail sent
    /// using this alias. This is the key identifier for the alias.
    pub send_as_email: String,

    /// A name that appears in the "From:" header for mail sent using this
    /// alias. For custom "from" addresses, when this is empty, Gmail will
    /// populate the "From:" header with the name that is used for the
    /// primary address associated with the account.
    #[serde(default)]
    pub display_name: Option<String>,

    /// An optional email address that is included in a "Reply-To:" header
    /// for mail sent using this alias. If this is empty, Gmail will not
    /// generate a "Reply-To:" header.
    #[serde(default)]
    pub reply_to_address: Option<String>,

    /// An optional HTML signature that is included in messages composed
    /// with this alias in the Gmail web UI.
    #[serde(default)]
    pub signature: Option<String>,

    /// Whether this address is the primary address used to login to the
    /// account. Every Gmail account has exactly one primary address, and
    /// it cannot be deleted from the collection of send-as aliases.
    #[serde(default)]
    pub is_primary: bool,

    /// Whether this address is selected as the default "From:" address in
    /// situations such as composing a new message or sending a vacation
    /// auto-reply.
    #[serde(default)]
    pub is_default: bool,

    /// Whether Gmail should treat this address as an alias for the user's
    /// primary email address. This setting only applies to custom "from"
    /// aliases. When false, the alias will be shown separately in the
    /// sender dropdown.
    #[serde(default)]
    pub treat_as_alias: bool,

    /// Indicates whether this address has been verified for use as a
    /// send-as alias. Send-as aliases that have not been verified cannot
    /// be used to send mail.
    #[serde(default)]
    pub verification_status: SendAsVerificationStatus,

    /// An SMTP server to use when sending with this alias.
    /// Only populated for custom "from" addresses that use a custom SMTP relay.
    #[serde(default)]
    pub smtp_msa: Option<SmtpMsa>,
}

/// Verification status for a send-as alias.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SendAsVerificationStatus {
    /// The alias has been verified and can be used to send mail.
    Accepted,
    /// The verification is still pending.
    Pending,
    /// The verification status is unknown.
    #[default]
    #[serde(other)]
    VerificationStatusUnspecified,
}

impl SendAsVerificationStatus {
    /// Returns true if the alias has been verified.
    pub fn is_verified(self) -> bool {
        matches!(self, Self::Accepted)
    }
}

/// Configuration for custom SMTP relay (only used for custom "from" addresses
/// with external SMTP).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtpMsa {
    /// The hostname of the SMTP service.
    pub host: String,
    /// The port of the SMTP service.
    pub port: i32,
    /// The username for authentication with the SMTP service.
    #[serde(default)]
    pub username: Option<String>,
    /// The protocol that will be used to secure communication with the SMTP service.
    #[serde(default)]
    pub security_mode: SmtpSecurityMode,
}

/// Security mode for SMTP connections.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SmtpSecurityMode {
    /// Communication with the remote SMTP service is unsecured.
    None,
    /// Communication with the remote SMTP service is secured using SSL.
    Ssl,
    /// Communication with the remote SMTP service is secured using STARTTLS.
    Starttls,
    /// The security mode is unspecified.
    #[default]
    #[serde(other)]
    SecurityModeUnspecified,
}
