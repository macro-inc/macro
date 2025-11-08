#[cfg(any(
    feature = "chat",
    feature = "convert",
    feature = "document",
    feature = "document_text_extractor",
    feature = "email",
    feature = "gmail",
    feature = "upload_extractor"
))]
pub(crate) fn build_string_message_attribute(
    attr: &str,
) -> anyhow::Result<aws_sdk_sqs::types::MessageAttributeValue> {
    let result = aws_sdk_sqs::types::MessageAttributeValue::builder()
        .data_type("String")
        .string_value(attr)
        .build()?;
    Ok(result)
}

#[cfg(any(feature = "gmail", feature = "organization_retention"))]
/// generified so we can pass different integer sizes
pub(crate) fn build_number_message_attribute<T>(
    attr: T,
) -> anyhow::Result<aws_sdk_sqs::types::MessageAttributeValue>
where
    T: std::fmt::Display + Copy,
{
    let result = aws_sdk_sqs::types::MessageAttributeValue::builder()
        .data_type("Number")
        .string_value(attr.to_string())
        .build()?;
    Ok(result)
}
