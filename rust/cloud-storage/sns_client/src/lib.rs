use aws_sdk_sns::{operation::publish::PublishOutput, types::MessageAttributeValue};
use serde::{Serialize, Serializer};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct SNS {
    inner: aws_sdk_sns::Client,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "kebab-case")]
pub struct Aps {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert: Option<Alert>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<Sound>,

    /// Set to 1 for background/silent notifications
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_available: Option<u8>,

    /// Set to 1 to allow Notification Service Extension to modify
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutable_content: Option<u8>,

    /// Category identifier for actionable notifications
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,

    /// Identifier for grouping notifications
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,

    /// Relevance score for notification summary (0.0 to 1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance_score: Option<f64>,

    /// Interruption level: passive, active, time-sensitive, critical
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_level: Option<InterruptionLevel>,
}

#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum Alert {
    Simple(String),
    Dictionary(AlertDictionary),
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "kebab-case")]
pub struct AlertDictionary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,

    /// Localization key for title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_loc_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_loc_args: Option<Vec<String>>,

    /// Localization key for body
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub loc_args: Option<Vec<String>>,

    /// Custom launch image filename
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_image: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum Sound {
    Default(String), // Usually "default"
    Critical(CriticalSound),
}

#[derive(Serialize, Debug)]
pub struct CriticalSound {
    pub critical: u8, // 1 for critical
    pub name: String,
    pub volume: f64, // 0.0 to 1.0
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum InterruptionLevel {
    Passive,
    Active,
    TimeSensitive,
    Critical,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct APNSPushNotification<T> {
    pub aps: Aps,

    /// custom data payload to send to the client.
    /// This data has no effect on 'how' the notification is delivered
    #[serde(flatten)]
    pub push_notification_data: T,
}

impl<T> APNSPushNotification<T> {
    pub fn map<F, U>(self, cb: F) -> APNSPushNotification<U>
    where
        F: FnOnce(T) -> U,
    {
        let APNSPushNotification {
            aps,
            push_notification_data,
        } = self;
        APNSPushNotification {
            aps,
            push_notification_data: cb(push_notification_data),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GCMPushNotification<T> {
    fcm_v1_message: FCMMessage<T>,
}

#[derive(Debug, Serialize)]
pub struct FCMMessage<T> {
    android: AndroidData,
    data: T,
}

impl<T> FCMMessage<T> {
    /// temporary method since android is currently out of scope for mobile
    /// this just instantiates a majority blank notif
    pub fn new_temporary_empty(data: T) -> Self {
        FCMMessage {
            android: AndroidData {
                notification: "Temporary placeholder".to_string(),
                priority: AndroidNotifPrio::Normal,
                collapse_key: String::new(),
            },
            data,
        }
    }
}

#[derive(Debug, Serialize)]
enum AndroidNotifPrio {
    Normal,
    #[expect(dead_code)]
    High,
}

#[derive(Debug, Serialize)]
pub struct AndroidData {
    notification: String,
    priority: AndroidNotifPrio,
    collapse_key: String,
}

#[derive(Debug)]
pub enum SnsTarget<T> {
    Ios(Box<APNSPushNotification<T>>),
    Android(FCMMessage<T>),
}

impl<T> SnsTarget<T> {
    fn default_string(&self) -> String {
        match self {
            SnsTarget::Ios(apnspush_notification) => apnspush_notification
                .aps
                .alert
                .as_ref()
                .and_then(|a| match a {
                    Alert::Simple(s) => Some(s.clone()),
                    Alert::Dictionary(alert_dictionary) => alert_dictionary.title.clone(),
                })
                .unwrap_or(String::new()),
            SnsTarget::Android(fcmmessage) => fcmmessage.android.notification.clone(),
        }
    }
    fn as_payload(&self) -> SnsPayload<'_, T> {
        match self {
            SnsTarget::Ios(apnspush_notification) => SnsPayload::Ios {
                default: self.default_string(),
                apns: apnspush_notification,
                apns_sandbox: apnspush_notification,
            },
            SnsTarget::Android(fcmmessage) => SnsPayload::Android {
                default: self.default_string(),
                gcm: fcmmessage,
            },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(bound = "T: Serialize", untagged)]
pub enum SnsPayload<'a, T> {
    Ios {
        default: String,
        #[serde(rename = "APNS", serialize_with = "stringified_json")]
        apns: &'a APNSPushNotification<T>,
        #[serde(rename = "APNS_SANDBOX", serialize_with = "stringified_json")]
        apns_sandbox: &'a APNSPushNotification<T>,
    },
    Android {
        default: String,
        #[serde(rename = "GCM", serialize_with = "stringified_json")]
        gcm: &'a FCMMessage<T>,
    },
}

fn stringified_json<T, S>(val: &T, ser: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
    T: Serialize,
{
    let s = serde_json::to_string(val).expect("json serialize cant fail");
    ser.serialize_str(&s)
}

impl<'a, T> SnsPayload<'a, T>
where
    T: Serialize,
{
    fn as_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

#[derive(Debug, Clone)]
pub enum PushType {
    Background,
    Alert,
}

impl PushType {
    fn as_static_str(&self) -> &'static str {
        match self {
            PushType::Background => "background",
            PushType::Alert => "alert",
        }
    }
}

#[derive(Debug, Clone)]
pub struct MessageAttributes {
    pub push_type: PushType,
    pub apns_bundle_id: &'static str,
    pub collapse_key: String,
}

impl MessageAttributes {
    pub fn into_json(self) -> HashMap<String, MessageAttributeValue> {
        HashMap::from([
            (
                "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
                MessageAttributeValue::builder()
                    .data_type("String")
                    .string_value(self.apns_bundle_id)
                    .build()
                    .unwrap(),
            ),
            (
                "AWS.SNS.MOBILE.APNS.PUSH_TYPE".to_string(),
                MessageAttributeValue::builder()
                    .data_type("String")
                    .string_value(self.push_type.as_static_str())
                    .build()
                    .unwrap(),
            ),
            (
                "AWS.SNS.MOBILE.APNS.PRIORITY".to_string(),
                MessageAttributeValue::builder()
                    .data_type("String")
                    .string_value("5") // 5 is normal, 10 is high
                    .build()
                    .unwrap(),
            ),
            (
                "AWS.SNS.MOBILE.APNS.COLLAPSE_ID".to_string(),
                MessageAttributeValue::builder()
                    .data_type("String")
                    .string_value(self.collapse_key)
                    .build()
                    .unwrap(),
            ),
        ])
    }
}

pub trait NotificationSender: Send + Sync + 'static {
    fn push_notification<T>(
        &self,
        endpoint_arn: &str,
        message_json: &SnsTarget<T>,
        message_attributes: MessageAttributes,
    ) -> impl Future<Output = anyhow::Result<PublishOutput>> + Send
    where
        T: Serialize + std::fmt::Debug + Sync;
}

impl NotificationSender for SNS {
    async fn push_notification<T>(
        &self,
        endpoint_arn: &str,
        message_json: &SnsTarget<T>,
        message_attributes: MessageAttributes,
    ) -> anyhow::Result<PublishOutput>
    where
        T: Serialize + std::fmt::Debug + Sync,
    {
        self.push_notification(endpoint_arn, message_json, message_attributes)
            .await
    }
}

impl SNS {
    pub fn new(inner: aws_sdk_sns::Client) -> Self {
        Self { inner }
    }

    pub async fn publish(&self, topic_arn: &str, message: &str) -> anyhow::Result<()> {
        self.inner
            .publish()
            .topic_arn(topic_arn)
            .message(message)
            .send()
            .await?;

        Ok(())
    }

    pub async fn create_platform_endpoint(
        &self,
        platform_arn: &str,
        token: &str,
    ) -> anyhow::Result<String> {
        match self
            .inner
            .create_platform_endpoint()
            .platform_application_arn(platform_arn)
            .token(token)
            .send()
            .await?
            .endpoint_arn()
        {
            Some(endpoint) => Ok(endpoint.to_string()),
            None => Err(anyhow::anyhow!("unable to create platform endpoint")),
        }
    }

    pub async fn get_endpoint_attributes(
        &self,
        endpoint_arn: &str,
    ) -> anyhow::Result<HashMap<String, String>> {
        let output = self
            .inner
            .get_endpoint_attributes()
            .endpoint_arn(endpoint_arn)
            .send()
            .await?;

        match output.attributes() {
            Some(attrs) => Ok(attrs.clone()),
            None => Err(anyhow::anyhow!("unable to get endpoint attributes")),
        }
    }

    pub async fn set_endpoint_attributes(
        &self,
        endpoint_arn: &str,
        attributes: HashMap<String, String>,
    ) -> anyhow::Result<()> {
        self.inner
            .set_endpoint_attributes()
            .endpoint_arn(endpoint_arn)
            .set_attributes(Some(attributes))
            .send()
            .await?;

        Ok(())
    }

    /// Sends a push notification to the specified endpoint ARN.
    ///
    /// # Arguments
    ///
    /// * `endpoint_arn` - The ARN of the endpoint to send the notification to
    /// * `message_json` - The message in JSON format containing the notification data
    /// * `message_attributes` - Optional message attributes to include with the notification
    ///
    /// # Message Format Requirements
    ///
    /// The message JSON must be UTF-8 encoded strings and at most 256 KB in size with the following constraints:
    ///
    /// * Keys in the JSON object that correspond to supported transport protocols must have simple JSON string values.
    /// * The values will be parsed (unescaped) before they are used in outgoing messages.
    /// * Outbound notifications are JSON encoded (meaning that the characters will be reescaped for sending).
    /// * Values have a minimum length of 0 (the empty string, "", is allowed).
    /// * Values have a maximum length bounded by the overall message size (so, including multiple protocols may limit message sizes).
    /// * Non-string values will cause the key to be ignored.
    /// * Keys that do not correspond to supported transport protocols are ignored.
    /// * Duplicate keys are not allowed.
    /// * Failure to parse or validate any key or value in the message will cause the Publish call to return an error (no partial delivery).
    ///
    /// # Returns
    ///
    /// * `Ok(())` if the notification was sent successfully
    /// * `Err` if there was an error sending the notification
    #[tracing::instrument(err, skip(self))]
    pub async fn push_notification<T>(
        &self,
        endpoint_arn: &str,
        message_json: &SnsTarget<T>,
        message_attributes: MessageAttributes,
    ) -> anyhow::Result<PublishOutput>
    where
        T: Serialize + std::fmt::Debug,
    {
        let result = self
            .inner
            .publish()
            .target_arn(endpoint_arn)
            .message_structure("json")
            .message(message_json.as_payload().as_json().unwrap())
            .set_message_attributes(Some(message_attributes.into_json()))
            .send()
            .await?;

        Ok(result)
    }

    pub async fn delete_endpoint(&self, endpoint_arn: &str) -> anyhow::Result<()> {
        self.inner
            .delete_endpoint()
            .endpoint_arn(endpoint_arn)
            .send()
            .await?;

        Ok(())
    }
}
