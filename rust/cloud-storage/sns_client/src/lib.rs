use std::{borrow::Cow, collections::HashMap};

use aws_sdk_sns::{operation::publish::PublishOutput, types::MessageAttributeValue};
use serde::{Serialize, Serializer};

#[derive(Clone, Debug)]
pub struct SNS {
    inner: aws_sdk_sns::Client,
}

#[derive(Debug, Serialize)]
#[serde(bound = "A: Serialize, I: Serialize")]
pub struct SnsPayload<'a, A, I> {
    pub default: String,
    #[serde(rename = "APNS", serialize_with = "stringified_json")]
    pub apns: &'a I,
    #[serde(rename = "APNS_SANDBOX", serialize_with = "stringified_json")]
    pub apns_sandbox: &'a I,
    #[serde(rename = "GCM", serialize_with = "stringified_json")]
    pub gcm: &'a A,
}

fn stringified_json<T, S>(val: &T, ser: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
    T: Serialize,
{
    let s = serde_json::to_string(val).expect("json serialize cant fail");
    ser.serialize_str(&s)
}

impl<'a, A, I> SnsPayload<'a, A, I>
where
    A: Serialize,
    I: Serialize,
{
    fn into_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

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

pub struct NotifCollapseKey<'a>(Cow<'a, str>);

impl<'a> NotifCollapseKey<'a> {
    pub fn new_str(s: &'a str) -> Self {
        NotifCollapseKey(Cow::Borrowed(s))
    }
}

pub struct MessageAttributes<'a> {
    pub push_type: PushType,
    pub apns_bundle_id: &'static str,
    pub collapse_key: NotifCollapseKey<'a>,
}

impl<'a> MessageAttributes<'a> {
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
                    .string_value(self.collapse_key.0.into_owned())
                    .build()
                    .unwrap(),
            ),
        ])
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
    pub async fn push_notification<A, I>(
        &self,
        endpoint_arn: &str,
        message_json: SnsPayload<'_, A, I>,
        message_attributes: MessageAttributes<'_>,
    ) -> anyhow::Result<PublishOutput>
    where
        A: Serialize,
        I: Serialize,
    {
        let result = self
            .inner
            .publish()
            .target_arn(endpoint_arn)
            .message_structure("json")
            .message(message_json.into_json().unwrap())
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
