// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow store/clientpayload.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go keeps `BaseClientPayload` and `DeviceProps` as mutable package
// variables that `SetWAVersion` and `SetOSInfo` edit. The port keeps the two
// settings in locks and builds both messages from them on demand.

use std::fmt;
use std::num::ParseIntError;
use std::sync::{PoisonError, RwLock};

use md5::{Digest, Md5};
use prost::Message;

use super::store::Device;
use crate::proto::wa_companion_reg::{DeviceProps, device_props};
use crate::proto::wa_wa6::ClientPayload;
use crate::proto::wa_wa6::client_payload::{
    ConnectReason, ConnectType, DevicePairingRegistrationData, UserAgent, WebInfo, user_agent,
    web_info,
};
use crate::signal::DJB_TYPE;

/// A WhatsApp web version number.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct WaVersionContainer(pub [u32; 3]);

/// Why [`parse_version`] failed. The messages match whatsmeow's.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseVersionError {
    /// Not three parts.
    #[error("'{0}' doesn't contain three dot-separated parts")]
    WrongPartCount(String),
    /// A part isn't a number.
    #[error("{position} part of '{version}' is not a number: {source}")]
    NotANumber {
        /// "first", "second" or "third".
        position: &'static str,
        /// The whole version string.
        version: String,
        /// The parse failure.
        source: ParseIntError,
    },
}

/// Parses a version string (three dot-separated numbers).
pub fn parse_version(version: &str) -> Result<WaVersionContainer, ParseVersionError> {
    let parts: Vec<&str> = version.split('.').collect();
    let [first, second, third] = parts.as_slice() else {
        return Err(ParseVersionError::WrongPartCount(version.to_owned()));
    };
    let parse = |part: &str, position| {
        part.parse::<u32>()
            .map_err(|source| ParseVersionError::NotANumber {
                position,
                version: version.to_owned(),
                source,
            })
    };
    Ok(WaVersionContainer([
        parse(first, "first")?,
        parse(second, "second")?,
        parse(third, "third")?,
    ]))
}

impl WaVersionContainer {
    /// Whether this version is older than `other`.
    pub fn less_than(&self, other: &WaVersionContainer) -> bool {
        self.0 < other.0
    }

    /// Whether the version is all zeros.
    pub fn is_zero(&self) -> bool {
        self.0 == [0, 0, 0]
    }

    /// The MD5 hash of the dot-separated version.
    pub fn hash(&self) -> [u8; 16] {
        Md5::digest(self.to_string().as_bytes()).into()
    }

    /// The version as the client payload's app version.
    pub fn proto_app_version(&self) -> user_agent::AppVersion {
        user_agent::AppVersion {
            primary: Some(self.0[0]),
            secondary: Some(self.0[1]),
            tertiary: Some(self.0[2]),
            ..Default::default()
        }
    }
}

/// The version as a dot-separated string.
impl fmt::Display for WaVersionContainer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let [primary, secondary, tertiary] = self.0;
        write!(formatter, "{primary}.{secondary}.{tertiary}")
    }
}

/// The WhatsApp web client version.
static WA_VERSION: RwLock<WaVersionContainer> =
    RwLock::new(WaVersionContainer([2, 3000, 1050728964]));

/// The OS name and version set with [`set_os_info`].
static OS_INFO: RwLock<Option<(String, [u32; 3])>> = RwLock::new(None);

/// The current WhatsApp web client version.
pub fn get_wa_version() -> WaVersionContainer {
    *WA_VERSION.read().unwrap_or_else(PoisonError::into_inner)
}

/// Sets the WhatsApp web client version. A zero version is ignored.
///
/// In general, keep the library up to date instead, as newer versions may
/// need code changes too (like protobuf schema changes).
pub fn set_wa_version(version: WaVersionContainer) {
    if version.is_zero() {
        return;
    }
    *WA_VERSION.write().unwrap_or_else(PoisonError::into_inner) = version;
}

/// Sets the OS name and version the device reports while pairing and in its
/// user agent.
pub fn set_os_info(name: &str, version: [u32; 3]) {
    *OS_INFO.write().unwrap_or_else(PoisonError::into_inner) = Some((name.to_owned(), version));
}

fn os_info() -> Option<(String, [u32; 3])> {
    OS_INFO
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

/// The client payload fields shared by registration and login (Go's
/// `BaseClientPayload`).
pub fn base_client_payload() -> ClientPayload {
    build_base_client_payload(get_wa_version(), os_info())
}

fn build_base_client_payload(
    version: WaVersionContainer,
    os_info: Option<(String, [u32; 3])>,
) -> ClientPayload {
    let os_version = os_info.map_or_else(
        || "0.1".to_owned(),
        |(_, [primary, secondary, tertiary])| format!("{primary}.{secondary}.{tertiary}"),
    );
    ClientPayload {
        user_agent: Some(UserAgent {
            platform: Some(user_agent::Platform::Web.into()),
            release_channel: Some(user_agent::ReleaseChannel::Release.into()),
            app_version: Some(version.proto_app_version()),
            mcc: Some("000".to_owned()),
            mnc: Some("000".to_owned()),
            os_version: Some(os_version.clone()),
            manufacturer: Some(String::new()),
            device: Some("Desktop".to_owned()),
            os_build_number: Some(os_version),
            locale_language_iso6391: Some("en".to_owned()),
            locale_country_iso31661_alpha2: Some("US".to_owned()),
            ..Default::default()
        }),
        web_info: Some(WebInfo {
            web_sub_platform: Some(web_info::WebSubPlatform::WebBrowser.into()),
            ..Default::default()
        }),
        connect_type: Some(ConnectType::WifiUnknown.into()),
        connect_reason: Some(ConnectReason::UserActivated.into()),
        ..Default::default()
    }
}

/// The device properties sent while pairing (Go's `DeviceProps`).
pub fn device_props() -> DeviceProps {
    build_device_props(os_info())
}

fn build_device_props(os_info: Option<(String, [u32; 3])>) -> DeviceProps {
    let (os, [primary, secondary, tertiary]) =
        os_info.unwrap_or_else(|| ("whatsmeow".to_owned(), [0, 1, 0]));
    DeviceProps {
        os: Some(os),
        version: Some(device_props::AppVersion {
            primary: Some(primary),
            secondary: Some(secondary),
            tertiary: Some(tertiary),
            ..Default::default()
        }),
        history_sync_config: Some(device_props::HistorySyncConfig {
            storage_quota_mb: Some(10240),
            inline_initial_payload_in_e2_ee_msg: Some(true),
            support_call_log_history: Some(true),
            support_bot_user_agent_chat_history: Some(true),
            support_cag_reactions_and_polls: Some(true),
            support_biz_hosted_msg: Some(true),
            support_recent_sync_chunk_message_count_tuning: Some(true),
            support_hosted_group_msg: Some(true),
            support_fbid_bot_chat_history: Some(true),
            support_message_association: Some(true),
            support_group_history: Some(true),
            thumbnail_sync_days_limit: Some(60),
            support_manus_history: Some(true),
            support_hatch_history: Some(true),
            ..Default::default()
        }),
        platform_type: Some(device_props::PlatformType::Unknown.into()),
        require_full_sync: Some(false),
    }
}

/// Why [`Device::get_client_payload`] failed (Go panics).
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ClientPayloadError {
    /// The device has an ID, but it is the empty JID.
    #[error("GetClientPayload called with empty JID")]
    EmptyJid,
    /// A new device needs a signed prekey signature to register.
    #[error("signed prekey has no signature")]
    UnsignedPreKey,
}

impl Device {
    fn get_registration_payload(&self) -> Result<ClientPayload, ClientPayloadError> {
        let signature = self
            .signed_pre_key
            .signature
            .ok_or(ClientPayloadError::UnsignedPreKey)?;
        let mut payload = base_client_payload();
        payload.device_pairing_data = Some(DevicePairingRegistrationData {
            e_regid: Some(self.registration_id.to_be_bytes().to_vec()),
            e_keytype: Some(vec![DJB_TYPE]),
            e_ident: Some(self.identity_key.public.to_vec()),
            e_skey_id: Some(self.signed_pre_key.key_id.to_be_bytes()[1..].to_vec()),
            e_skey_val: Some(self.signed_pre_key.key_pair.public.to_vec()),
            e_skey_sig: Some(signature.to_vec()),
            build_hash: Some(get_wa_version().hash().to_vec()),
            device_props: Some(device_props().encode_to_vec()),
        });
        payload.passive = Some(false);
        payload.pull = Some(false);
        Ok(payload)
    }

    fn get_login_payload(&self, id: &crate::types::Jid) -> ClientPayload {
        let mut payload = base_client_payload();
        payload.username = Some(id.user_int());
        payload.device = Some(u32::from(id.device));
        payload.passive = Some(true);
        payload.pull = Some(true);
        payload.lid_db_migrated = Some(true);
        payload.lc.get_or_insert(1);
        payload
    }

    /// The payload of the last handshake message: a login for a paired
    /// device, a registration for a new one.
    pub fn get_client_payload(&self) -> Result<ClientPayload, ClientPayloadError> {
        match &self.id {
            Some(id) if *id == crate::types::Jid::default() => Err(ClientPayloadError::EmptyJid),
            Some(id) => Ok(self.get_login_payload(id)),
            None => self.get_registration_payload(),
        }
    }
}

#[cfg(test)]
mod test;
