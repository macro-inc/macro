use super::{ReadChannelMessageContext, ReadChannelMessages, ReadChannelThread};
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn read_channel_messages_schema_is_valid() {
    let result = generate_validated_input_schema::<ReadChannelMessages>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ReadChannelMessages");
    assert!(
        validated
            .description
            .contains("Read a small structured window")
    );
}

#[test]
fn read_channel_message_context_schema_is_valid() {
    let result = generate_validated_input_schema::<ReadChannelMessageContext>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ReadChannelMessageContext");
    assert!(
        validated
            .description
            .contains("Read the local channel and thread context")
    );
}

#[test]
fn read_channel_thread_schema_is_valid() {
    let result = generate_validated_input_schema::<ReadChannelThread>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ReadChannelThread");
    assert!(validated.description.contains("Read"));
}
