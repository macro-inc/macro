use std::collections::HashMap;

use aws_sdk_sns::operation::publish::PublishOutput;

#[derive(Clone, Debug)]
pub struct SNS {
    inner: aws_sdk_sns::Client,
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
    pub async fn push_notification(
        &self,
        endpoint_arn: &str,
        message_json: &str,
        message_attributes: Option<HashMap<String, aws_sdk_sns::types::MessageAttributeValue>>,
    ) -> anyhow::Result<PublishOutput> {
        let result = self
            .inner
            .publish()
            .target_arn(endpoint_arn)
            .message_structure("json")
            .message(message_json)
            .set_message_attributes(message_attributes)
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
