use super::{ReadChannelMessageContext, ReadChannelMessages, ReadChannelThread};
use ai_toolset::tool_object::validate_tool_schema;
use ai_toolset::{generate_tool_input_schema, generate_tool_output_schema};

#[test]
fn read_channel_messages_schema_is_valid() {
    let schema = generate_tool_input_schema!(ReadChannelMessages);
    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{result:?}");
    let (name, description) = result.unwrap();
    assert_eq!(name, "ReadChannelMessages");
    assert!(description.contains("Read a small structured window"));

    let _ = generate_tool_output_schema!(super::ReadChannelMessagesResponse);
}

#[test]
fn read_channel_message_context_schema_is_valid() {
    let schema = generate_tool_input_schema!(ReadChannelMessageContext);
    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{result:?}");
    let (name, description) = result.unwrap();
    assert_eq!(name, "ReadChannelMessageContext");
    assert!(description.contains("Read the local channel and thread context"));

    let _ = generate_tool_output_schema!(super::ReadChannelMessageContextResponse);
}

#[test]
fn read_channel_thread_schema_is_valid() {
    let schema = generate_tool_input_schema!(ReadChannelThread);
    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{result:?}");
    let (name, description) = result.unwrap();
    assert_eq!(name, "ReadChannelThread");
    assert!(description.contains("Read"));

    let _ = generate_tool_output_schema!(super::ReadChannelThreadResponse);
}
