/// Builds a string message attribute
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

/// Builds a number message attribute
#[tracing::instrument]
pub(crate) fn build_number_message_attribute(
    attr: i32,
) -> anyhow::Result<aws_sdk_sqs::types::MessageAttributeValue> {
    let result = aws_sdk_sqs::types::MessageAttributeValue::builder()
        .data_type("Number")
        .string_value(attr.to_string())
        .build()?;
    Ok(result)
}
