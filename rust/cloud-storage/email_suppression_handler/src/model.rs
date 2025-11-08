#[derive(Debug, serde::Deserialize, strum::Display, strum::EnumString)]
pub enum NotificationType {
    #[strum(serialize = "Complaint")]
    #[serde(rename = "Complaint")]
    Complaint,
    #[strum(serialize = "Bounce")]
    #[serde(rename = "Bounce")]
    Bounce,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailNotification {
    pub notification_type: NotificationType,
    pub bounce: Option<BounceNotification>,
    pub complaint: Option<ComplaintNotification>,
}

#[derive(Debug, serde::Deserialize, strum::Display, strum::EnumString)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ComplaintFeedbackType {
    /// Indicates unsolicited email or some other kind of email abuse.
    Abuse,
    /// Email authentication failure report.
    AuthFailure,
    // Indicates some kind of fraud or phishing activity.
    Fraud,
    // Indicates that the entity providing the report does not consider the message to be spam. This may be used to correct a message that was incorrectly tagged or categorized as spam.
    NotSpam,
    // Indicates any other feedback that does not fit into other registered types.
    Other,
    // Reports that a virus is found in the originating message.
    Virus,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplainedRecipient {
    /// The email address of the recipient.
    pub email_address: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ComplaintNotification {
    /// A list that contains information about recipients that may have been responsible for the complaint. For more information, see Complained recipients.
    pub complained_recipients: Vec<ComplainedRecipient>,
    /// The date and time when the ISP sent the complaint notification, in ISO 8601 format. The date and time in this field might not be the same as the date and time when Amazon SES received the notification.
    pub timestamp: String,
    /// A unique ID associated with the complaint.
    pub feedback_id: String,
    /// The value of the complaintSubType field can either be null or OnAccountSuppressionList. If the value is OnAccountSuppressionList, Amazon SES accepted the message, but didn't attempt to send it because it was on the account-level suppression list.
    pub complaint_sub_type: Option<String>,

    // -- The following fields are only present if the feedback report is attached to the complaint.
    /// The value of the User-Agent field from the feedback report. This indicates the name and version of the system that generated the report.
    pub user_agent: Option<String>,
    /// The value of the Feedback-Type field from the feedback report received from the ISP. This contains the type of feedback.
    pub complaint_feedback_type: Option<ComplaintFeedbackType>,
    /// The value of the Arrival-Date or Received-Date field from the feedback report (in ISO8601 format). This field may be absent in the report (and therefore also absent in the JSON).
    pub arrival_date: Option<String>,
}

#[derive(Debug, serde::Deserialize, strum::Display, strum::EnumString)]
pub enum BounceType {
    #[strum(serialize = "Undetermined")]
    #[serde(rename = "Undetermined")]
    Undetermined,
    #[strum(serialize = "Permanent")]
    #[serde(rename = "Permanent")]
    Permanent,
    #[strum(serialize = "Transient")]
    #[serde(rename = "Transient")]
    Transient,
}

#[derive(Debug, serde::Deserialize, strum::Display, strum::EnumString)]
pub enum BounceSubType {
    /// The recipient's email provider sent a bounce message. The bounce message didn't contain enough information for Amazon SES to determine the reason for the bounce.
    /// The bounce email, which was sent to the address in the Return-Path header of the email that resulted in the bounce, might contain additional information about the issue that caused the email to bounce.
    #[strum(serialize = "Undetermined")]
    #[serde(rename = "Undetermined")]
    Undetermined,
    /// Can be used under BounceType Permanent or Transient.
    /// **BounceType Permanent** The recipient's email provider sent a hard bounce message.
    /// **Important** When you receive this type of bounce notification, you should immediately remove the recipient's email address from your mailing list.
    /// Sending messages to addresses that produce hard bounces can have a negative impact on your reputation as a sender.
    /// If you continue sending email to addresses that produce hard bounces, we might pause your ability to send additional email.
    ///
    /// **BounceType Transient** The recipient's email provider sent a general bounce message.
    /// You might be able to send a message to the same recipient in the future if the issue that caused the message to bounce is resolved.
    /// If you send an email to a recipient who has an active automatic response rule (such as an "out of the office" message), you might receive this type of notification. Even though the response has a notification type of Bounce, Amazon SES doesn't count automatic responses when it calculates the bounce rate for your account.
    #[strum(serialize = "General")]
    #[serde(rename = "General")]
    General,
    /// It was not possible to retrieve the recipient email address from the bounce message.
    #[strum(serialize = "NoEmail")]
    #[serde(rename = "NoEmail")]
    NoEmail,
    /// The recipient's email address is on the Amazon SES suppression list because it has a recent history of producing hard bounces. To override the global suppression list, see Using the Amazon SES account-level suppression list.
    #[strum(serialize = "Suppressed")]
    #[serde(rename = "Suppressed")]
    Suppressed,
    /// Amazon SES has suppressed sending to this address because it is on the account-level suppression list. This does not count toward your bounce rate metric.
    #[strum(serialize = "OnAccountSuppressionList")]
    #[serde(rename = "OnAccountSuppressionList")]
    OnAccountSuppressionList,
    /// The recipient's email provider sent a bounce message because the recipient's inbox was full. You might be able to send to the same recipient in the future when the mailbox is no longer full.
    #[strum(serialize = "MailboxFull")]
    #[serde(rename = "MailboxFull")]
    MailboxFull,
    /// The recipient's email provider sent a bounce message because message you sent was too large. You might be able to send a message to the same recipient if you reduce the size of the message.
    #[strum(serialize = "MessageTooLarge")]
    #[serde(rename = "MessageTooLarge")]
    MessageTooLarge,
    /// The recipient's email provider sent a bounce message because the message you sent contains content that the provider doesn't allow. You might be able to send a message to the same recipient if you change the content of the message.
    #[strum(serialize = "ContentRejected")]
    #[serde(rename = "ContentRejected")]
    ContentRejected,
    /// The recipient's email provider sent a bounce message because the message contained an unacceptable attachment. For example, some email providers may reject messages with attachments of a certain file type, or messages with very large attachments. You might be able to send a message to the same recipient if you remove or change the content of the attachment.
    #[strum(serialize = "AttachmentRejected")]
    AttachmentRejected,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct BouncedRecipient {
    /// The email address of the recipient. If a DSN is available, this is the value of the Final-Recipient field from the DSN.
    pub email_address: String,
    /// The value of the Action field from the DSN. This indicates the action performed by the Reporting-MTA as a result of its attempt to deliver the message to this recipient.
    pub action: Option<String>,
    /// The value of the Status field from the DSN. This is the per-recipient transport-independent status code that indicates the delivery status of the message.
    pub status: Option<String>,
    /// The status code issued by the reporting MTA. This is the value of the Diagnostic-Code field from the DSN. This field may be absent in the DSN (and therefore also absent in the JSON).
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct BounceNotification {
    /// The type of bounce, as determined by Amazon SES.
    pub bounce_type: BounceType,
    /// The subtype of the bounce, as determined by Amazon SES.
    pub bounce_sub_type: BounceSubType,
    /// A list that contains information about the recipients of the original mail that bounced.
    pub bounced_recipients: Vec<BouncedRecipient>,
    /// The date and time at which the bounce was sent (in ISO8601 format). Note that this is the time at which the notification was sent by the ISP, and not the time at which it was received by Amazon SES.
    pub timestamp: String,
    /// A unique ID for the bounce.
    pub feedback_id: String,
    /// The IP address of the MTA to which Amazon SES attempted to deliver the email.
    pub remote_mta_ip: Option<String>,
    /// The value of the Reporting-MTA field from the DSN. This is the value of the MTA that attempted to perform the delivery, relay, or gateway operation described in the DSN.
    pub reporting_mta: Option<String>,
}
