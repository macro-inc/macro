use cool_asserts::assert_matches;

use crate::parse::{
    ParsedContactMention, ParsedDateMention, ParsedDocumentMention, ParsedGroupMention, ParsedLink,
    ParsedUserMention, ParsedXmlText, TextSegment, XmlTag,
};

// =============================================================================
// Basic parsing tests
// =============================================================================

#[test]
fn plain_message() {
    let input = "I'm testing a regular message";
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [TextSegment::Plain("I'm testing a regular message")]);
}

#[test]
fn empty_string() {
    let out = ParsedXmlText::parse("").unwrap();
    assert!(out.0.is_empty());
}

// =============================================================================
// Document mention tests
// =============================================================================

#[test]
fn parse_single_document_mention() {
    let input = r#"<m-document-mention>{"documentName":"My Doc"}</m-document-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name }))
    ] => {
        assert_eq!(document_name.as_ref(), "My Doc");
    });
}

#[test]
fn parse_document_mentions_with_text() {
    let input = r#"I'm testing sending a message with a document  <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Document 1","blockParams":{}}</m-document-mention> mention  <m-document-mention>{"documentId":"doc-2","blockName":"md","documentName":"Document 2","blockParams":{}}</m-document-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();

    assert_matches!(out.0, [
        TextSegment::Plain("I'm testing sending a message with a document  "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name: name1 })),
        TextSegment::Plain(" mention  "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name: name2 })),
    ] => {
        assert_eq!(name1.as_ref(), "Document 1");
        assert_eq!(name2.as_ref(), "Document 2");
    });
}

#[test]
fn parse_document_mention_missing_name() {
    // Missing "documentName" field - should fail to parse as document mention
    let input = r#"<m-document-mention>{"documentId":"123","blockName":"md","blockParams":{}}</m-document-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_document_mention_invalid_json() {
    let input = r#"<m-document-mention>???</m-document-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

// =============================================================================
// User mention tests
// =============================================================================

#[test]
fn parse_single_user_mention() {
    let input = r#"<m-user-mention>{"userId":"macro|rithy@macro.com","email":"rithy@macro.com"}</m-user-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::User(ParsedUserMention { user_id, email }))
    ] => {
        assert_eq!(user_id.0.as_ref(), "macro|rithy@macro.com");
        assert_eq!(email.as_ref(), "rithy@macro.com");
    });
}

#[test]
fn parse_multiple_user_mentions() {
    let input = r#"Hello <m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention> and <m-user-mention>{"userId":"macro|c@d.com","email":"c@d.com"}</m-user-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Hello "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { user_id: uid1, email: email1 })),
        TextSegment::Plain(" and "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { user_id: uid2, email: email2 })),
    ] => {
        assert_eq!(uid1.0.as_ref(), "macro|a@b.com");
        assert_eq!(email1.as_ref(), "a@b.com");
        assert_eq!(uid2.0.as_ref(), "macro|c@d.com");
        assert_eq!(email2.as_ref(), "c@d.com");
    });
}

#[test]
fn parse_user_mention_missing_email() {
    // Missing "email" field - should fail to parse
    let input = r#"<m-user-mention>{"userId":"macro|chase@macro.com"}</m-user-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_user_mention_invalid_json() {
    let input = r#"<m-user-mention>invalid</m-user-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

// =============================================================================
// Contact mention tests
// =============================================================================

#[test]
fn parse_contact_mention() {
    let input = r#"asdf <m-contact-mention>{"contactId":"ness@macro.com","name":"Ness Chu","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> asdf"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("asdf "),
        TextSegment::Xml(XmlTag::Contact(ParsedContactMention { name })),
        TextSegment::Plain(" asdf"),
    ] => {
        assert_eq!(name.as_ref(), "Ness Chu");
    });
}

#[test]
fn parse_contact_mention_missing_name() {
    // Missing "name" field - should fail to parse
    let input = r#"<m-contact-mention>{"contactId":"ness@macro.com","emailOrDomain":"ness@macro.com"}</m-contact-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_contact_mention_invalid_json() {
    let input = r#"<m-contact-mention>not-json</m-contact-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

// =============================================================================
// Date mention tests
// =============================================================================

#[test]
fn parse_date_mention() {
    let input = r#"asdf <m-date-mention>{"date":"2025-12-01T05:00:00.000Z","displayFormat":"Mon, Dec 1, 2025"}</m-date-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("asdf "),
        TextSegment::Xml(XmlTag::Date(ParsedDateMention { display_format })),
    ] => {
        assert_eq!(display_format.as_ref(), "Mon, Dec 1, 2025");
    });
}

#[test]
fn parse_date_mention_missing_display_format() {
    // Missing "displayFormat" field - should fail to parse
    let input = r#"<m-date-mention>{"date":"2025-12-01T05:00:00.000Z"}</m-date-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_date_mention_invalid_json() {
    let input = r#"<m-date-mention>{broken</m-date-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

// =============================================================================
// Link tests
// =============================================================================

#[test]
fn parse_link_different_text_and_url() {
    let input = r#"Visit <m-link>{"text":"Example Website","url":"https://www.example.com"}</m-link> today"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Visit "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
        TextSegment::Plain(" today"),
    ] => {
        assert_eq!(text.as_ref(), "Example Website");
        assert_eq!(url.as_ref(), "https://www.example.com");
    });
}

#[test]
fn parse_link_same_text_and_url() {
    let input = r#"<m-link>{"url":"https://example.com","text":"https://example.com"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "https://example.com");
        assert_eq!(url.as_ref(), "https://example.com");
    });
}

#[test]
fn parse_multiple_links() {
    let input = r#"Check out <m-link>{"text":"Google","url":"https://google.com"}</m-link> and also <m-link>{"text":"https://github.com","url":"https://github.com"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Check out "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text: t1, url: u1 })),
        TextSegment::Plain(" and also "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text: t2, url: u2 })),
    ] => {
        assert_eq!(t1.as_ref(), "Google");
        assert_eq!(u1.as_ref(), "https://google.com");
        assert_eq!(t2.as_ref(), "https://github.com");
        assert_eq!(u2.as_ref(), "https://github.com");
    });
}

#[test]
fn parse_link_empty_text() {
    let input = r#"<m-link>{"text":"","url":"https://www.example.com"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "");
        assert_eq!(url.as_ref(), "https://www.example.com");
    });
}

#[test]
fn parse_link_with_special_characters() {
    let input = r#"<m-link>{"text":"Search: \"hello world\"","url":"https://example.com?q=hello%20world&sort=date"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "Search: \"hello world\"");
        assert_eq!(url.as_ref(), "https://example.com?q=hello%20world&sort=date");
    });
}

#[test]
fn parse_link_missing_text() {
    // Missing "text" field - should fail to parse
    let input = r#"<m-link>{"url":"https://www.example.com"}</m-link>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_link_missing_url() {
    // Missing "url" field - should fail to parse
    let input = r#"<m-link>{"text":"Example Link"}</m-link>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_link_invalid_json() {
    let input = r#"<m-link>{"text":"Example","url":INVALID}</m-link>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_link_with_title_field() {
    // Title field should be ignored, only text and url matter
    let input =
        r#"<m-link>{"url":"https://example.com","text":"Example","title":"A title"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "Example");
        assert_eq!(url.as_ref(), "https://example.com");
    });
}

#[test]
fn parse_link_unicode_characters() {
    let input = r#"<m-link>{"text":"测试链接 🔗","url":"https://example.com/测试"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "测试链接 🔗");
        assert_eq!(url.as_ref(), "https://example.com/测试");
    });
}

// =============================================================================
// Mixed mention tests
// =============================================================================

#[test]
fn parse_mixed_mentions() {
    let input = r#"Hi <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention>, let's discuss <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention> with <m-contact-mention>{"contactId":"ness@macro.com","name":"Ness Chu","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> on <m-date-mention>{"date":"2025-12-01T05:00:00.000Z","displayFormat":"Mon, Dec 1, 2025"}</m-date-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Hi "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(", let's discuss "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name })),
        TextSegment::Plain(" with "),
        TextSegment::Xml(XmlTag::Contact(ParsedContactMention { name })),
        TextSegment::Plain(" on "),
        TextSegment::Xml(XmlTag::Date(ParsedDateMention { display_format })),
    ] => {
        assert_eq!(email.as_ref(), "chase@macro.com");
        assert_eq!(document_name.as_ref(), "Test Doc 34");
        assert_eq!(name.as_ref(), "Ness Chu");
        assert_eq!(display_format.as_ref(), "Mon, Dec 1, 2025");
    });
}

#[test]
fn parse_mixed_mentions_with_links() {
    let input = r#"Hi <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention>, check out <m-link>{"text":"Our Docs","url":"https://docs.example.com"}</m-link> and <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Hi "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(", check out "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
        TextSegment::Plain(" and "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name })),
    ] => {
        assert_eq!(email.as_ref(), "chase@macro.com");
        assert_eq!(text.as_ref(), "Our Docs");
        assert_eq!(url.as_ref(), "https://docs.example.com");
        assert_eq!(document_name.as_ref(), "Test Doc 34");
    });
}

#[test]
fn parse_content_with_multiple_document_and_user_mentions() {
    let input = r#"<m-user-mention>{"userId":"macro|rithy@macro.com","email":"rithy@macro.com"}</m-user-mention> I'm testing sending a message with a document  <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Document 1","blockParams":{}}</m-document-mention> mention  <m-document-mention>{"documentId":"doc-2","blockName":"md","documentName":"Document 2","blockParams":{}}</m-document-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(" I'm testing sending a message with a document  "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name: name1 })),
        TextSegment::Plain(" mention  "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name: name2 })),
    ] => {
        assert_eq!(email.as_ref(), "rithy@macro.com");
        assert_eq!(name1.as_ref(), "Document 1");
        assert_eq!(name2.as_ref(), "Document 2");
    });
}

// =============================================================================
// Edge cases
// =============================================================================

#[test]
fn parse_text_with_angle_brackets_but_no_mentions() {
    // Text with < that isn't a valid tag should fail since we can't parse it
    let input = "5 < 10 and 10 > 5";
    let result = ParsedXmlText::parse(input);
    // This will fail because < starts something that isn't a valid tag
    assert!(result.is_err());
}

#[test]
fn parse_consecutive_mentions_no_space() {
    let input = r#"<m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention><m-user-mention>{"userId":"macro|c@d.com","email":"c@d.com"}</m-user-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email: e1, .. })),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email: e2, .. })),
    ] => {
        assert_eq!(e1.as_ref(), "a@b.com");
        assert_eq!(e2.as_ref(), "c@d.com");
    });
}

#[test]
fn parse_mention_at_start() {
    let input =
        r#"<m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention> hello"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(" hello"),
    ] => {
        assert_eq!(email.as_ref(), "a@b.com");
    });
}

#[test]
fn parse_mention_at_end() {
    let input =
        r#"hello <m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("hello "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
    ] => {
        assert_eq!(email.as_ref(), "a@b.com");
    });
}

// =============================================================================
// Additional tests to match original test coverage
// =============================================================================

#[test]
fn parse_user_mention_with_surrounding_text() {
    let input = r#"asdf <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention> asdf"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("asdf "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(" asdf"),
    ] => {
        assert_eq!(email.as_ref(), "chase@macro.com");
    });
}

#[test]
fn parse_document_mention_with_surrounding_text() {
    let input = r#"asdf <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention> asdf"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("asdf "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name })),
        TextSegment::Plain(" asdf"),
    ] => {
        assert_eq!(document_name.as_ref(), "Test Doc 34");
    });
}

#[test]
fn parse_plain_message_no_mentions() {
    let input = "Just a regular message with no mentions";
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(
        out.0,
        [TextSegment::Plain(
            "Just a regular message with no mentions"
        )]
    );
}

#[test]
fn parse_user_mention_invalid_json_with_suffix() {
    let input =
        r#"<m-user-mention>{"userId":"macro|chase@macro.com",INVALID}</m-user-mention> asdf"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_link_same_text_url_with_surrounding_text() {
    let input = r#"Check out this link <m-link>{"text":"https://www.example.com","url":"https://www.example.com"}</m-link> for more info"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Check out this link "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
        TextSegment::Plain(" for more info"),
    ] => {
        assert_eq!(text.as_ref(), "https://www.example.com");
        assert_eq!(url.as_ref(), "https://www.example.com");
    });
}

#[test]
fn parse_link_empty_text_with_prefix() {
    let input = r#"Link: <m-link>{"text":"","url":"https://www.example.com"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Link: "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "");
        assert_eq!(url.as_ref(), "https://www.example.com");
    });
}

#[test]
fn parse_link_special_chars_with_prefix() {
    let input = r#"Complex link <m-link>{"text":"Search: \"hello world\"","url":"https://example.com?q=hello%20world&sort=date"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Complex link "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "Search: \"hello world\"");
        assert_eq!(url.as_ref(), "https://example.com?q=hello%20world&sort=date");
    });
}

#[test]
fn parse_link_missing_text_with_suffix() {
    let input = r#"<m-link>{"url":"https://www.example.com"}</m-link> missing text field"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_link_missing_url_with_suffix() {
    let input = r#"<m-link>{"text":"Example Link"}</m-link> missing url field"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_link_invalid_json_with_suffix() {
    let input = r#"<m-link>{"text":"Example","url":INVALID}</m-link> invalid json"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_mixed_mentions_with_multiple_links() {
    let input = r#"Hi <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention>, check out <m-link>{"text":"Our Docs","url":"https://docs.example.com"}</m-link> and <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention> on <m-date-mention>{"date":"2025-12-01T05:00:00.000Z","displayFormat":"Mon, Dec 1, 2025"}</m-date-mention> or visit <m-link>{"text":"https://example.com","url":"https://example.com"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Hi "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(", check out "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text: t1, .. })),
        TextSegment::Plain(" and "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name })),
        TextSegment::Plain(" on "),
        TextSegment::Xml(XmlTag::Date(ParsedDateMention { display_format })),
        TextSegment::Plain(" or visit "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text: t2, url: u2 })),
    ] => {
        assert_eq!(email.as_ref(), "chase@macro.com");
        assert_eq!(t1.as_ref(), "Our Docs");
        assert_eq!(document_name.as_ref(), "Test Doc 34");
        assert_eq!(display_format.as_ref(), "Mon, Dec 1, 2025");
        assert_eq!(t2.as_ref(), "https://example.com");
        assert_eq!(u2.as_ref(), "https://example.com");
    });
}

#[test]
fn parse_link_user_document_mixed() {
    let input = r#"Check out <m-link>{"text":"Example","url":"https://example.com"}</m-link> and <m-user-mention>{"userId":"macro|rithy@macro.com","email":"rithy@macro.com"}</m-user-mention> this doc <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Document 1","blockParams":{}}</m-document-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Check out "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
        TextSegment::Plain(" and "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
        TextSegment::Plain(" this doc "),
        TextSegment::Xml(XmlTag::Document(ParsedDocumentMention { document_name })),
    ] => {
        assert_eq!(text.as_ref(), "Example");
        assert_eq!(url.as_ref(), "https://example.com");
        assert_eq!(email.as_ref(), "rithy@macro.com");
        assert_eq!(document_name.as_ref(), "Document 1");
    });
}

#[test]
fn parse_link_markdown_characters_in_text() {
    let input = r#"Link with special chars <m-link>{"text":"[Already] (Markdown) *Format*","url":"https://example.com"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Link with special chars "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "[Already] (Markdown) *Format*");
        assert_eq!(url.as_ref(), "https://example.com");
    });
}

#[test]
fn parse_link_unicode_with_prefix() {
    let input =
        r#"Unicode link <m-link>{"text":"测试链接 🔗","url":"https://example.com/测试"}</m-link>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Unicode link "),
        TextSegment::Xml(XmlTag::Link(ParsedLink { text, url })),
    ] => {
        assert_eq!(text.as_ref(), "测试链接 🔗");
        assert_eq!(url.as_ref(), "https://example.com/测试");
    });
}

#[test]
fn parse_contact_mention_missing_name_with_suffix() {
    let input = r#"<m-contact-mention>{"contactId":"ness@macro.com","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> asdf"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_user_mention_missing_email_with_suffix() {
    let input = r#"<m-user-mention>{"userId":"macro|chase@macro.com"}</m-user-mention> asdf"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_document_mention_missing_name_with_suffix() {
    let input = r#"<m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","blockParams":{},"collapsed":false}</m-document-mention> asdf"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

// =============================================================================
// Group mention tests
// =============================================================================

#[test]
fn parse_single_group_mention() {
    let input = r#"<m-group-mention>{"groupAlias":"here"}</m-group-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Group(ParsedGroupMention { group_alias }))
    ] => {
        assert_eq!(group_alias.as_ref(), "here");
    });
}

#[test]
fn parse_group_mention_with_surrounding_text() {
    let input = r#"Hey <m-group-mention>{"groupAlias":"here"}</m-group-mention> check this out"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Plain("Hey "),
        TextSegment::Xml(XmlTag::Group(ParsedGroupMention { group_alias })),
        TextSegment::Plain(" check this out"),
    ] => {
        assert_eq!(group_alias.as_ref(), "here");
    });
}

#[test]
fn parse_group_mention_missing_alias() {
    let input = r#"<m-group-mention>{}</m-group-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_group_mention_invalid_json() {
    let input = r#"<m-group-mention>invalid</m-group-mention>"#;
    let result = ParsedXmlText::parse(input);
    assert!(result.is_err());
}

#[test]
fn parse_group_mention_with_user_mention() {
    let input = r#"<m-group-mention>{"groupAlias":"here"}</m-group-mention> and <m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention>"#;
    let out = ParsedXmlText::parse(input).unwrap();
    assert_matches!(out.0, [
        TextSegment::Xml(XmlTag::Group(ParsedGroupMention { group_alias })),
        TextSegment::Plain(" and "),
        TextSegment::Xml(XmlTag::User(ParsedUserMention { email, .. })),
    ] => {
        assert_eq!(group_alias.as_ref(), "here");
        assert_eq!(email.as_ref(), "a@b.com");
    });
}
