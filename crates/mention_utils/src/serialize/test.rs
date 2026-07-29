use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[test]
fn serializes_user_mention() {
    let user_id = MacroUserIdStr::try_from_email("new.user@example.com").unwrap();

    assert_eq!(
        user_mention(&user_id).unwrap(),
        "<m-user-mention>{\"userId\":\"macro|new.user@example.com\",\"email\":\"new.user@example.com\"}</m-user-mention>"
    );
}

#[test]
fn serializes_bot_mention() {
    assert_eq!(
        bot_mention(bot_id::MACRO_AI_BOT_ID, bot_id::MACRO_AI_NAME).unwrap(),
        "<m-user-mention>{\"userId\":\"bot|00000000-0000-0000-0000-00000000a1a1\",\"email\":\"Macro\"}</m-user-mention>"
    );
}

#[test]
fn serializes_document_mention() {
    assert_eq!(
        document_mention("6e01a670-0000-0000-0000-00000000f47d", "Macro how to guide").unwrap(),
        "<m-document-mention>{\"documentId\":\"6e01a670-0000-0000-0000-00000000f47d\",\"blockName\":\"md\",\"documentName\":\"Macro how to guide\",\"blockParams\":{},\"collapsed\":false}</m-document-mention>"
    );
}
