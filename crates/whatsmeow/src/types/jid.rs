// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/jid.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::fmt;
use std::num::ParseIntError;
use std::str::FromStr;
use std::sync::LazyLock;

use crate::signal::SignalAddress;

// Known JID servers on WhatsApp.

/// The server of regular (phone number) users.
pub const DEFAULT_USER_SERVER: &str = "s.whatsapp.net";
/// The server of groups.
pub const GROUP_SERVER: &str = "g.us";
/// The legacy server of regular users.
pub const LEGACY_USER_SERVER: &str = "c.us";
/// The server of broadcast lists and the status broadcast.
pub const BROADCAST_SERVER: &str = "broadcast";
/// The server of LID (hidden user) JIDs.
pub const HIDDEN_USER_SERVER: &str = "lid";
/// The server of Messenger users.
pub const MESSENGER_SERVER: &str = "msgr";
/// The server of interop users.
pub const INTEROP_SERVER: &str = "interop";
/// The server of newsletters (channels).
pub const NEWSLETTER_SERVER: &str = "newsletter";
/// The server of hosted (business API) users.
pub const HOSTED_SERVER: &str = "hosted";
/// The server of hosted LID users.
pub const HOSTED_LID_SERVER: &str = "hosted.lid";
/// The server of bots.
pub const BOT_SERVER: &str = "bot";

// Some JIDs that are contacted often.

/// The empty JID.
pub static EMPTY_JID: LazyLock<Jid> = LazyLock::new(Jid::default);
/// The group server itself.
pub static GROUP_SERVER_JID: LazyLock<Jid> = LazyLock::new(|| new_jid("", GROUP_SERVER));
/// The user server itself.
pub static SERVER_JID: LazyLock<Jid> = LazyLock::new(|| new_jid("", DEFAULT_USER_SERVER));
/// The broadcast server itself.
pub static BROADCAST_SERVER_JID: LazyLock<Jid> = LazyLock::new(|| new_jid("", BROADCAST_SERVER));
/// The status broadcast.
pub static STATUS_BROADCAST_JID: LazyLock<Jid> =
    LazyLock::new(|| new_jid("status", BROADCAST_SERVER));
/// The legacy public service announcement account.
pub static LEGACY_PSA_JID: LazyLock<Jid> = LazyLock::new(|| new_jid("0", LEGACY_USER_SERVER));
/// The public service announcement account.
pub static PSA_JID: LazyLock<Jid> = LazyLock::new(|| new_jid("0", DEFAULT_USER_SERVER));
/// The official WhatsApp business account.
pub static OFFICIAL_BUSINESS_JID: LazyLock<Jid> =
    LazyLock::new(|| new_jid("16505361212", LEGACY_USER_SERVER));
/// Meta AI on the user server.
pub static META_AI_JID: LazyLock<Jid> =
    LazyLock::new(|| new_jid("13135550002", DEFAULT_USER_SERVER));
/// Meta AI on the bot server.
pub static NEW_META_AI_JID: LazyLock<Jid> =
    LazyLock::new(|| new_jid("867051314767696", BOT_SERVER));
/// Also known as "hatch".
pub static MUSE_JID: LazyLock<Jid> = LazyLock::new(|| new_jid("1807055946647697", BOT_SERVER));

/// The main domain type that WhatsApp uses.
pub const WHATSAPP_DOMAIN: u8 = 0;
/// The domain for LID type JIDs.
pub const LID_DOMAIN: u8 = 1;
/// The domain for hosted type JIDs.
pub const HOSTED_DOMAIN: u8 = 128;
/// The domain for hosted LID type JIDs.
pub const HOSTED_LID_DOMAIN: u8 = 129;

/// The internal ID of a WhatsApp message.
pub type MessageId = String;

/// The server ID of a WhatsApp newsletter message.
pub type MessageServerId = i64;

/// A WhatsApp user ID.
///
/// There are two types of JIDs: regular JID pairs (user and server) and AD-JIDs
/// (user, agent and device). AD JIDs are only used to refer to specific devices
/// of users, so the server is always s.whatsapp.net (`DEFAULT_USER_SERVER`).
/// Regular JIDs can be used for entities on any servers (users, groups,
/// broadcasts).
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Jid {
    /// The user part, e.g. a phone number.
    pub user: String,
    /// The agent of an AD JID.
    pub raw_agent: u8,
    /// The device number of an AD JID.
    pub device: u16,
    /// The integrator of an interop JID.
    pub integrator: u16,
    /// The server part.
    pub server: String,
}

/// An error from [`parse_jid`]. The messages match whatsmeow's.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum JidParseError {
    /// The user part had more than one dot.
    #[error("unexpected number of dots in JID")]
    UnexpectedDots,
    /// The user part had more than one colon.
    #[error("unexpected number of colons in JID")]
    UnexpectedColons,
    /// The agent or device wasn't a number in range. Go truncates out-of-range
    /// numbers silently; the port rejects them.
    #[error("failed to parse device from JID: {0}")]
    InvalidDevice(#[source] ParseIntError),
}

impl Jid {
    /// The domain type of the JID, derived from the server where it implies one.
    pub fn actual_agent(&self) -> u8 {
        match self.server.as_str() {
            DEFAULT_USER_SERVER => WHATSAPP_DOMAIN,
            HIDDEN_USER_SERVER => LID_DOMAIN,
            HOSTED_SERVER => HOSTED_DOMAIN,
            HOSTED_LID_SERVER => HOSTED_LID_DOMAIN,
            _ => self.raw_agent,
        }
    }

    /// The user as an integer. This is only meaningful for normal users, not
    /// for groups or broadcast lists; anything unparseable is 0.
    pub fn user_int(&self) -> u64 {
        self.user.parse().unwrap_or_default()
    }

    /// A version of the JID that doesn't have the agent and device set.
    pub fn to_non_ad(&self) -> Jid {
        Jid {
            user: self.user.clone(),
            server: self.server.clone(),
            integrator: self.integrator,
            ..Jid::default()
        }
    }

    /// The Signal protocol address for the user.
    pub fn signal_address(&self) -> SignalAddress {
        SignalAddress::new(self.signal_address_user(), u32::from(self.device))
    }

    /// The name part of the Signal protocol address: the user, suffixed with
    /// the domain type when it isn't the default.
    pub fn signal_address_user(&self) -> String {
        let agent = self.actual_agent();
        if agent != 0 {
            format!("{}_{}", self.user, agent)
        } else {
            self.user.clone()
        }
    }

    /// Whether the JID is a broadcast list, but not the status broadcast.
    pub fn is_broadcast_list(&self) -> bool {
        self.server == BROADCAST_SERVER && self.user != STATUS_BROADCAST_JID.user
    }

    /// Whether the JID belongs to a bot.
    pub fn is_bot(&self) -> bool {
        (self.server == DEFAULT_USER_SERVER
            && lazy_regex::regex_is_match!(r"^1313555\d{4}$|^131655500\d{2}$", &self.user)
            && self.device == 0)
            || self.server == BOT_SERVER
    }

    /// The JID in `user.agent:device@server` form, even when agent and device are 0.
    pub fn ad_string(&self) -> String {
        format!(
            "{}.{}:{}@{}",
            self.user, self.raw_agent, self.device, self.server
        )
    }

    /// Whether the JID has no server (which is required for all JIDs).
    pub fn is_empty(&self) -> bool {
        self.server.is_empty()
    }

    /// Same as [`Jid::is_empty`].
    pub fn is_zero(&self) -> bool {
        self.is_empty()
    }
}

/// Creates a new AD JID.
///
/// The agent is really the domain type; WhatsApp usually places them in the
/// same position. Known domain types pick the server, anything else is kept as
/// the agent of a regular user.
pub fn new_ad_jid(user: &str, agent: u8, device: u8) -> Jid {
    let (server, agent) = match agent {
        LID_DOMAIN => (HIDDEN_USER_SERVER, 0),
        HOSTED_DOMAIN => (HOSTED_SERVER, 0),
        HOSTED_LID_DOMAIN => (HOSTED_LID_SERVER, 0),
        _ => (DEFAULT_USER_SERVER, agent),
    };
    Jid {
        user: user.to_owned(),
        raw_agent: agent,
        device: u16::from(device),
        integrator: 0,
        server: server.to_owned(),
    }
}

/// Parses a JID out of the given string. It supports both regular and AD JIDs.
pub fn parse_jid(jid: &str) -> Result<Jid, JidParseError> {
    let parts: Vec<&str> = jid.split('@').collect();
    if parts.len() == 1 {
        return Ok(new_jid("", parts[0]));
    }
    let mut parsed = new_jid(parts[0], parts[1]);
    if parts[0].contains('.') {
        let dot_parts: Vec<&str> = parts[0].split('.').collect();
        if dot_parts.len() != 2 {
            return Err(JidParseError::UnexpectedDots);
        }
        parsed.user = dot_parts[0].to_owned();
        let colon_parts: Vec<&str> = dot_parts[1].split(':').collect();
        if colon_parts.len() > 2 {
            return Err(JidParseError::UnexpectedColons);
        }
        parsed.raw_agent = colon_parts[0]
            .parse()
            .map_err(JidParseError::InvalidDevice)?;
        if let Some(device) = colon_parts.get(1) {
            parsed.device = device.parse().map_err(JidParseError::InvalidDevice)?;
        }
    } else if parts[0].contains(':') {
        let colon_parts: Vec<&str> = parts[0].split(':').collect();
        if colon_parts.len() != 2 {
            return Err(JidParseError::UnexpectedColons);
        }
        parsed.user = colon_parts[0].to_owned();
        parsed.device = colon_parts[1]
            .parse()
            .map_err(JidParseError::InvalidDevice)?;
    }
    Ok(parsed)
}

/// Creates a new regular JID.
pub fn new_jid(user: &str, server: &str) -> Jid {
    Jid {
        user: user.to_owned(),
        server: server.to_owned(),
        ..Jid::default()
    }
}

/// The string representation of the JID, which [`parse_jid`] can parse back.
impl fmt::Display for Jid {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.server.is_empty() {
            Ok(())
        } else if self.raw_agent > 0 {
            write!(
                formatter,
                "{}.{}:{}@{}",
                self.user, self.raw_agent, self.device, self.server
            )
        } else if self.device > 0 {
            write!(formatter, "{}:{}@{}", self.user, self.device, self.server)
        } else if !self.user.is_empty() {
            write!(formatter, "{}@{}", self.user, self.server)
        } else {
            formatter.write_str(&self.server)
        }
    }
}

impl FromStr for Jid {
    type Err = JidParseError;

    fn from_str(jid: &str) -> Result<Self, Self::Err> {
        parse_jid(jid)
    }
}

#[cfg(test)]
mod test;
