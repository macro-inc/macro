/// Builds a string message attribute
// TODO this would only fail from programmer error: when "data_type" not set.
// it should not return a result.
#[tracing::instrument]
pub(crate) fn build_string_message_attribute(
    attr: &str,
) -> aws_sdk_sqs::types::MessageAttributeValue {
    aws_sdk_sqs::types::MessageAttributeValue::builder()
        .data_type("String")
        .string_value(attr)
        .build()
        .expect("only fails when `data_type` is not set. it is set above")
}
