// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow errors.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go returns `error` values compared with `errors.Is`; here every client
// error is a [`ClientError`] variant. Go's `fmt.Errorf("…: %w", err)`
// wrapping is [`ClientError::Wrapped`], and [`ClientError::is`] follows the
// wrap chain like `errors.Is`. The media errors live in `download.rs`.

//! The errors the client returns.

use std::fmt;

use crate::binary::{AttrError, ErrorList, Node};
use crate::handshake::HandshakeError;
use crate::signal::SignalError;
use crate::socket::SocketError;
use crate::store::StoreError;

/// An error returned by the client.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// `ErrNoSession`.
    #[error("can't encrypt message for device: no signal session established")]
    NoSession,
    /// `ErrIQTimedOut`.
    #[error("info query timed out")]
    IqTimedOut,
    /// `ErrNotConnected`.
    #[error("websocket not connected")]
    NotConnected,
    /// `ErrNotLoggedIn`.
    #[error("the store doesn't contain a device JID")]
    NotLoggedIn,
    /// `ErrMessageTimedOut`.
    #[error("timed out waiting for message send response")]
    MessageTimedOut,
    /// `ErrAlreadyConnected`.
    #[error("websocket is already connected")]
    AlreadyConnected,
    /// `ErrQRAlreadyConnected`.
    #[error("GetQRChannel must be called before connecting")]
    QrAlreadyConnected,
    /// `ErrQRStoreContainsID`.
    #[error("GetQRChannel can only be called when there's no user ID in the client's Store")]
    QrStoreContainsId,
    /// `ErrNoPushName`.
    #[error("can't send presence without PushName set")]
    NoPushName,
    /// `ErrNoPrivacyToken`.
    #[error("no privacy token stored")]
    NoPrivacyToken,
    /// `ErrAppStateUpdate`.
    #[error("server returned error updating app state")]
    AppStateUpdate,

    /// `ErrPairInvalidDeviceIdentityHMAC`.
    #[error("invalid device identity HMAC in pair success message")]
    PairInvalidDeviceIdentityHmac,
    /// `ErrPairInvalidDeviceSignature`.
    #[error("invalid device signature in pair success message")]
    PairInvalidDeviceSignature,
    /// `ErrPairRejectedLocally`.
    #[error("local PrePairCallback rejected pairing")]
    PairRejectedLocally,
    /// `PairProtoError`: pairing failed on a protobuf error.
    #[error("{message}: {source}")]
    PairProto {
        /// What failed.
        message: String,
        /// The protobuf error.
        source: PairProtoSource,
    },
    /// `PairDatabaseError`: pairing failed saving the credentials.
    #[error("{message}: {source}")]
    PairDatabase {
        /// What failed.
        message: String,
        /// The store error.
        source: StoreError,
    },

    /// `ErrNotInGroup`.
    #[error("you're not participating in that group")]
    NotInGroup,
    /// `ErrGroupNotFound`.
    #[error("that group does not exist")]
    GroupNotFound,
    /// `ErrGroupInviteLinkUnauthorized`.
    #[error("you don't have the permission to get the group's invite link")]
    GroupInviteLinkUnauthorized,
    /// `ErrInviteLinkInvalid`.
    #[error("that group invite link is not valid")]
    InviteLinkInvalid,
    /// `ErrInviteLinkRevoked`.
    #[error("that group invite link has been revoked")]
    InviteLinkRevoked,
    /// `ErrProfilePictureUnauthorized`.
    #[error("the user has hidden their profile picture from you")]
    ProfilePictureUnauthorized,
    /// `ErrProfilePictureNotSet`.
    #[error("that user or group does not have a profile picture")]
    ProfilePictureNotSet,
    /// `ErrInvalidImageFormat`.
    #[error("the given data is not a valid image")]
    InvalidImageFormat,

    /// `ErrBroadcastListUnsupported`.
    #[error("sending to non-status broadcast lists is not yet supported")]
    BroadcastListUnsupported,
    /// `ErrUnknownServer`.
    #[error("can't send message to unknown server")]
    UnknownServer,
    /// `ErrRecipientADJID`.
    #[error("message recipient must be a user JID with no device part")]
    RecipientAdJid,
    /// `ErrServerReturnedError`.
    #[error("server returned error")]
    ServerReturnedError,
    /// `ErrNoPermissionInGroup`.
    #[error("no permission to send that message in the group")]
    NoPermissionInGroup,

    /// `ErrOriginalMessageSecretNotFound`.
    #[error("original message secret key not found")]
    OriginalMessageSecretNotFound,
    /// `ErrNotEncryptedReactionMessage`.
    #[error("given message isn't an encrypted reaction message")]
    NotEncryptedReactionMessage,
    /// `ErrNotEncryptedCommentMessage`.
    #[error("given message isn't an encrypted comment message")]
    NotEncryptedCommentMessage,
    /// `ErrNotPollUpdateMessage`.
    #[error("given message isn't a poll update message")]
    NotPollUpdateMessage,
    /// `ErrMediaNotAvailableOnPhone`.
    #[error("media no longer available on phone")]
    MediaNotAvailableOnPhone,
    /// `ErrUnknownMediaRetryError`.
    #[error("unknown media retry error")]
    UnknownMediaRetryError,
    /// `ErrPhoneNumberTooShort`.
    #[error("phone number too short")]
    PhoneNumberTooShort,
    /// `ErrPhoneNumberIsNotInternational`.
    #[error("international phone number required (must not start with 0)")]
    PhoneNumberIsNotInternational,
    /// `ErrNotSecretEncryptedMessage`.
    #[error("given message isn't a secret encrypted message")]
    NotSecretEncryptedMessage,

    /// `IQError`: an info query returned an error.
    #[error(transparent)]
    Iq(Box<IqError>),
    /// `ElementMissingError`: a required XML element is missing.
    #[error("missing <{tag}> element in {in_}")]
    ElementMissing {
        /// The missing tag.
        tag: String,
        /// Where it was expected.
        in_: String,
    },
    /// `DisconnectedError`: the websocket disconnected before a response.
    #[error(transparent)]
    Disconnected(Box<DisconnectedError>),

    /// A websocket failure.
    #[error(transparent)]
    Socket(#[from] SocketError),
    /// The noise handshake failed.
    #[error("noise handshake failed: {0}")]
    Handshake(Box<HandshakeError>),
    /// A store failure.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// A media download failed.
    #[error(transparent)]
    Download(Box<crate::download::DownloadError>),
    /// A media upload or delete failed.
    #[error(transparent)]
    Upload(Box<crate::upload::UploadError>),
    /// The media connection response didn't parse.
    #[error(transparent)]
    MediaConn(#[from] crate::mediaconn::MediaConnError),
    /// An app state patch list didn't parse.
    #[error(transparent)]
    AppStateParse(Box<crate::appstate::ParsePatchListError>),
    /// App state patches didn't decode or verify. Its
    /// [`sentinel`](crate::appstate::DecodeError::sentinel) is Go's
    /// `errors.Is` against the appstate errors.
    #[error(transparent)]
    AppStateDecode(Box<crate::appstate::DecodeError>),
    /// An app state patch couldn't be encoded.
    #[error(transparent)]
    AppStateEncode(Box<crate::appstate::EncodeError>),
    /// A Signal protocol failure.
    #[error(transparent)]
    Signal(#[from] SignalError),
    /// Encoding a node failed.
    #[error("failed to marshal node: {0}")]
    Marshal(#[from] crate::binary::EncodeError),
    /// A protobuf didn't decode.
    #[error(transparent)]
    ProtoDecode(#[from] prost::DecodeError),
    /// Node attributes didn't parse.
    #[error("{0}")]
    Attrs(#[from] ErrorList),
    /// One node attribute didn't parse.
    #[error(transparent)]
    Attr(#[from] AttrError),
    /// An error from another layer, with Go's `fmt.Errorf` message.
    #[error("{0}")]
    Other(String),
    /// Go's `wrappedIQError`: a human readable error (the message) in front
    /// of the IQ error that caused it. [`ClientError::is`] matches both.
    #[error("{human}")]
    WrappedIq {
        /// The human readable error.
        human: Box<ClientError>,
        /// The IQ error.
        iq: Box<ClientError>,
    },
    /// Go's `fmt.Errorf("context: %w", err)`.
    #[error("{context}: {source}")]
    Wrapped {
        /// The context.
        context: String,
        /// The wrapped error.
        source: Box<ClientError>,
    },
}

/// The protobuf failure inside a pairing error.
#[derive(Debug, thiserror::Error)]
pub enum PairProtoSource {
    /// Decoding failed.
    #[error(transparent)]
    Decode(#[from] prost::DecodeError),
}

impl From<IqError> for ClientError {
    fn from(error: IqError) -> Self {
        ClientError::Iq(Box::new(error))
    }
}

impl From<DisconnectedError> for ClientError {
    fn from(error: DisconnectedError) -> Self {
        ClientError::Disconnected(Box::new(error))
    }
}

impl From<crate::download::DownloadError> for ClientError {
    fn from(error: crate::download::DownloadError) -> Self {
        ClientError::Download(Box::new(error))
    }
}

impl From<crate::upload::UploadError> for ClientError {
    fn from(error: crate::upload::UploadError) -> Self {
        ClientError::Upload(Box::new(error))
    }
}

impl From<crate::appstate::ParsePatchListError> for ClientError {
    fn from(error: crate::appstate::ParsePatchListError) -> Self {
        ClientError::AppStateParse(Box::new(error))
    }
}

impl From<crate::appstate::DecodeError> for ClientError {
    fn from(error: crate::appstate::DecodeError) -> Self {
        ClientError::AppStateDecode(Box::new(error))
    }
}

impl From<crate::appstate::EncodeError> for ClientError {
    fn from(error: crate::appstate::EncodeError) -> Self {
        ClientError::AppStateEncode(Box::new(error))
    }
}

impl From<HandshakeError> for ClientError {
    fn from(error: HandshakeError) -> Self {
        ClientError::Handshake(Box::new(error))
    }
}

impl ClientError {
    /// An IQ error with just a status, to compare against with
    /// [`ClientError::is`] (Go's `ErrIQNotFound` and friends).
    pub fn iq_status(status: (i64, &'static str)) -> ClientError {
        IqError::from_status(status).into()
    }

    /// Wraps the error with context, like Go's `fmt.Errorf("context: %w", err)`.
    pub fn wrap(self, context: impl Into<String>) -> ClientError {
        ClientError::Wrapped {
            context: context.into(),
            source: Box::new(self),
        }
    }

    /// The innermost error, unwrapping [`ClientError::Wrapped`] and the IQ
    /// side of [`ClientError::WrappedIq`] (Go's `Unwrap`).
    pub fn innermost(&self) -> &ClientError {
        match self {
            ClientError::Wrapped { source, .. } => source.innermost(),
            ClientError::WrappedIq { iq, .. } => iq.innermost(),
            other => other,
        }
    }

    /// Go's `errors.Is` against a sentinel: compares the variant (and the
    /// code for IQ errors, the action for disconnects) along the wrap chain.
    pub fn is(&self, target: &ClientError) -> bool {
        let mut current = self;
        loop {
            if current.matches(target) {
                return true;
            }
            match current {
                ClientError::Wrapped { source, .. } => current = source,
                ClientError::WrappedIq { human, iq } => {
                    return human.is(target) || iq.is(target);
                }
                _ => return false,
            }
        }
    }

    fn matches(&self, target: &ClientError) -> bool {
        match (self, target) {
            (ClientError::Iq(error), ClientError::Iq(other)) => error.is(other),
            (ClientError::Disconnected(error), ClientError::Disconnected(other)) => {
                error.action == other.action
            }
            (ClientError::Wrapped { .. } | ClientError::WrappedIq { .. }, _)
            | (_, ClientError::Wrapped { .. } | ClientError::WrappedIq { .. }) => false,
            _ => std::mem::discriminant(self) == std::mem::discriminant(target),
        }
    }

    /// Whether this is an IQ error with the given status code.
    pub fn is_iq_code(&self, code: i64) -> bool {
        matches!(self.innermost(), ClientError::Iq(error) if error.code == code)
    }
}

/// An error returned by an info query (`IQError`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IqError {
    /// The status code, or 0.
    pub code: i64,
    /// The status text.
    pub text: String,
    /// The `<error>` node, if any.
    pub error_node: Option<Node>,
    /// The whole response.
    pub raw_node: Option<Node>,
}

/// `ErrIQBadRequest` and friends: IQ errors to compare against with
/// [`IqError::is`].
impl IqError {
    const fn status(code: i64, text: &'static str) -> (i64, &'static str) {
        (code, text)
    }

    /// 400 bad-request.
    pub const BAD_REQUEST: (i64, &'static str) = Self::status(400, "bad-request");
    /// 401 not-authorized.
    pub const NOT_AUTHORIZED: (i64, &'static str) = Self::status(401, "not-authorized");
    /// 403 forbidden.
    pub const FORBIDDEN: (i64, &'static str) = Self::status(403, "forbidden");
    /// 404 item-not-found.
    pub const NOT_FOUND: (i64, &'static str) = Self::status(404, "item-not-found");
    /// 405 not-allowed.
    pub const NOT_ALLOWED: (i64, &'static str) = Self::status(405, "not-allowed");
    /// 406 not-acceptable.
    pub const NOT_ACCEPTABLE: (i64, &'static str) = Self::status(406, "not-acceptable");
    /// 410 gone.
    pub const GONE: (i64, &'static str) = Self::status(410, "gone");
    /// 419 resource-limit.
    pub const RESOURCE_LIMIT: (i64, &'static str) = Self::status(419, "resource-limit");
    /// 423 locked.
    pub const LOCKED: (i64, &'static str) = Self::status(423, "locked");
    /// 429 rate-overlimit.
    pub const RATE_OVER_LIMIT: (i64, &'static str) = Self::status(429, "rate-overlimit");
    /// 500 internal-server-error.
    pub const INTERNAL_SERVER_ERROR: (i64, &'static str) =
        Self::status(500, "internal-server-error");
    /// 503 service-unavailable.
    pub const SERVICE_UNAVAILABLE: (i64, &'static str) = Self::status(503, "service-unavailable");
    /// 530 partial-server-error.
    pub const PARTIAL_SERVER_ERROR: (i64, &'static str) = Self::status(530, "partial-server-error");

    /// An IQ error with just a code and text, to compare against.
    pub fn from_status((code, text): (i64, &'static str)) -> IqError {
        IqError {
            code,
            text: text.to_owned(),
            ..IqError::default()
        }
    }

    /// Go's `IQError.Is`: equal codes and texts, or equal error nodes when
    /// there is no code.
    pub fn is(&self, other: &IqError) -> bool {
        if self.code != 0 && other.code != 0 {
            other.code == self.code && other.text == self.text
        } else if let (Some(node), Some(other_node)) = (&self.error_node, &other.error_node) {
            node.to_string() == other_node.to_string()
        } else {
            false
        }
    }
}

impl fmt::Display for IqError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.code == 0 {
            if let Some(error_node) = &self.error_node {
                write!(formatter, "info query returned unknown error: {error_node}")
            } else if let Some(raw_node) = &self.raw_node {
                write!(
                    formatter,
                    "info query returned unexpected response: {raw_node}"
                )
            } else {
                formatter.write_str("unknown info query error")
            }
        } else {
            write!(
                formatter,
                "info query returned status {}: {}",
                self.code, self.text
            )
        }
    }
}

impl std::error::Error for IqError {}

/// Parses the `<error>` child of an IQ error response.
pub fn parse_iq_error(node: &Node) -> IqError {
    let mut error = IqError {
        raw_node: Some(node.clone()),
        ..IqError::default()
    };
    if let Some(value) = node.get_optional_child_by_tag(&["error"]) {
        let mut attrs = value.attr_getter();
        error.code = attrs.optional_int("code");
        error.text = attrs.optional_string("text");
        error.error_node = Some(value.clone());
    }
    error
}

/// The websocket disconnected before a request got a response
/// (`DisconnectedError`).
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("websocket disconnected before {action} returned response")]
pub struct DisconnectedError {
    /// What was waiting for the response.
    pub action: String,
    /// The disconnect node.
    pub node: Option<Node>,
}

impl DisconnectedError {
    /// `ErrIQDisconnected`.
    pub fn iq() -> DisconnectedError {
        DisconnectedError {
            action: "info query".to_owned(),
            node: None,
        }
    }
}

/// `wrapIQError`: puts a human readable error in front of an IQ error.
pub fn wrap_iq_error(human: ClientError, iq: ClientError) -> ClientError {
    ClientError::WrappedIq {
        human: Box::new(human),
        iq: Box::new(iq),
    }
}

/// Shorthand for building [`ClientError::ElementMissing`].
pub fn element_missing(tag: &str, in_: &str) -> ClientError {
    ClientError::ElementMissing {
        tag: tag.to_owned(),
        in_: in_.to_owned(),
    }
}
