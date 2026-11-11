//! Present notifications from people as macOS communication notifications:
//! the sender's avatar replaces the app icon, and group conversations are
//! titled with their name, as on iOS.
//!
//! macOS 12+ honors this only when the signed app carries the
//! `com.apple.developer.usernotifications.communication` entitlement and lists
//! `INSendMessageIntent` in `NSUserActivityTypes`. Builds without the
//! entitlement (local development) deliver the plain notification.

use std::{sync::LazyLock, time::Duration};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::{AllocAnyThread, available, msg_send};
use objc2_foundation::{NSData, NSError, NSString, ns_string};
use objc2_intents::{
    INImage, INInteraction, INInteractionDirection, INOutgoingMessageType, INPerson,
    INPersonHandle, INPersonHandleType, INSendMessageIntent, INSpeakableString,
};
use objc2_user_notifications::{UNMutableNotificationContent, UNNotificationContent};
use serde::Deserialize;
use url::Url;

const AVATAR_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_AVATAR_BYTES: usize = 5 * 1024 * 1024;

static AVATAR_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(AVATAR_TIMEOUT)
        .build()
        .expect("a reqwest client with only a timeout configured always builds")
});

/// The person a notification is from.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sender {
    /// Stable identifier, such as a Macro user id or an agent's name.
    id: String,
    name: String,
    avatar_url: Option<String>,
}

impl Sender {
    /// The sender's avatar image. A notification without one is still worth
    /// delivering, so failures are logged rather than returned.
    #[tracing::instrument(name = "notification.desktop_avatar", skip_all)]
    pub(super) async fn download_avatar(&self) -> Option<Vec<u8>> {
        let url = Url::parse(self.avatar_url.as_deref()?)
            .ok()
            .filter(|url| url.scheme() == "https")?;
        let response = match AVATAR_CLIENT
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(?error, "Unable to download notification avatar");
                return None;
            }
        };
        match response.bytes().await {
            Ok(bytes) if bytes.len() <= MAX_AVATAR_BYTES => Some(bytes.to_vec()),
            Ok(bytes) => {
                tracing::warn!(bytes = bytes.len(), "Notification avatar is too large");
                None
            }
            Err(error) => {
                tracing::warn!(?error, "Unable to read notification avatar");
                None
            }
        }
    }
}

/// Present `content` as a message from `sender`. `group_name` is set for
/// conversations with more than two people.
pub(super) fn from_sender(
    content: Retained<UNMutableNotificationContent>,
    sender: &Sender,
    avatar: Option<&[u8]>,
    group_name: Option<&str>,
    conversation_id: Option<&str>,
) -> Retained<UNNotificationContent> {
    if !available!(macos = 12.0) {
        return Retained::into_super(content);
    }
    let intent = message_intent(&content, sender, avatar, group_name, conversation_id);
    donate_incoming(&intent);
    // SAFETY: Intents declares INSendMessageIntent's conformance to
    // UNNotificationContentProviding (macOS 12+, checked above); objc2 does not
    // bind that category, so send the message directly.
    let updated: Result<Retained<UNNotificationContent>, Retained<NSError>> =
        unsafe { msg_send![&*content, contentByUpdatingWithProvider: &*intent, error: _] };
    match updated {
        Ok(updated) => updated,
        Err(error) => {
            tracing::warn!(
                domain = %error.domain(),
                code = error.code(),
                "Unable to present notification as a message"
            );
            Retained::into_super(content)
        }
    }
}

fn message_intent(
    content: &UNMutableNotificationContent,
    sender: &Sender,
    avatar: Option<&[u8]>,
    group_name: Option<&str>,
    conversation_id: Option<&str>,
) -> Retained<INSendMessageIntent> {
    let id = NSString::from_str(&sender.id);
    let image = avatar.map(|bytes| {
        // SAFETY: INImage copies arbitrary image data; undecodable data only
        // leaves the avatar blank.
        unsafe { INImage::imageWithImageData(&NSData::with_bytes(bytes)) }
    });
    // SAFETY: every argument is a valid object or nil, as the initializers
    // allow; the objects are retained for as long as they are used.
    unsafe {
        let handle = INPersonHandle::initWithValue_type(
            INPersonHandle::alloc(),
            Some(&id),
            INPersonHandleType::Unknown,
        );
        let person =
            INPerson::initWithPersonHandle_nameComponents_displayName_image_contactIdentifier_customIdentifier(
                INPerson::alloc(),
                &handle,
                None,
                Some(&NSString::from_str(&sender.name)),
                image.as_deref(),
                None,
                Some(&id),
            );
        let group_name = group_name.map(|name| {
            INSpeakableString::initWithSpokenPhrase(
                INSpeakableString::alloc(),
                &NSString::from_str(name),
            )
        });
        let intent =
            INSendMessageIntent::initWithRecipients_outgoingMessageType_content_speakableGroupName_conversationIdentifier_serviceName_sender_attachments(
                INSendMessageIntent::alloc(),
                None,
                INOutgoingMessageType::OutgoingMessageText,
                Some(&content.body()),
                group_name.as_deref(),
                conversation_id.map(NSString::from_str).as_deref(),
                None,
                Some(&person),
                None,
            );
        intent.setImage_forParameterNamed(image.as_deref(), ns_string!("sender"));
        intent
    }
}

/// macOS uses donated messages to rank conversations and suggest them in
/// Focus and sharing.
fn donate_incoming(intent: &INSendMessageIntent) {
    // SAFETY: the intent is a valid INSendMessageIntent and no response is
    // required for an incoming message.
    let interaction =
        unsafe { INInteraction::initWithIntent_response(INInteraction::alloc(), intent, None) };
    let completion = RcBlock::new(|error: *mut NSError| {
        // SAFETY: the optional NSError is valid for this completion handler.
        if let Some(error) = unsafe { error.as_ref() } {
            tracing::warn!(
                domain = %error.domain(),
                code = error.code(),
                "Unable to donate notification message"
            );
        }
    });
    // SAFETY: the direction is a valid INInteractionDirection, and the
    // completion block is copied by the framework before this returns.
    unsafe {
        interaction.setDirection(INInteractionDirection::Incoming);
        interaction.donateInteractionWithCompletion(Some(&completion));
    }
}
