/// Builds a string message attribute
// TODO this would only fail from programmer error: when "data_type" not set.
// it should not return a result.
#[tracing::instrument]
pub(crate) fn build_string_message_attribute(
    attr: &str,
) -> anyhow::Result<aws_sdk_sqs::types::MessageAttributeValue> {
    let result = aws_sdk_sqs::types::MessageAttributeValue::builder()
        .data_type("String")
        .string_value(attr)
        .build()?;
    Ok(result)
}
