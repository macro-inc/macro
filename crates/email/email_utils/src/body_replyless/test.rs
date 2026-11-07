use super::compute_body_replyless;

#[test]
fn reply_html_preserves_attribute_order_across_thread_reads() {
    let html = r#"<div dir="ltr" class="reply" style="color: blue"><a href="https://example.com" title="A &amp; B" target="_blank">Reply</a></div><blockquote>Older message</blockquote>"#;
    let expected = r#"<div dir="ltr" class="reply" style="color: blue"><a href="https://example.com" title="A &amp; B" target="_blank">Reply</a></div>"#;

    for _ in 0..32 {
        assert_eq!(
            compute_body_replyless(None, Some(html), None).as_deref(),
            Some(expected)
        );
    }
}

#[test]
fn test_extract_message_reply_outlook_test_1() {
    let full_email = include_str!("testdata/outlook-test-1/full.html");
    let expected_reply = include_str!("testdata/outlook-test-1/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "outlook-test-1");
}

#[test]
fn test_extract_message_reply_outlook_test_2() {
    let full_email = include_str!("testdata/outlook-test-2/full.html");
    let expected_reply = include_str!("testdata/outlook-test-2/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "outlook-test-2");
}

#[test]
fn test_extract_message_reply_test_1() {
    let full_email = include_str!("testdata/test-1/full.html");
    let expected_reply = include_str!("testdata/test-1/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-1");
}

#[test]
fn test_extract_message_reply_test_2() {
    let full_email = include_str!("testdata/test-2/full.html");
    let expected_reply = include_str!("testdata/test-2/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-2");
}

#[test]
fn test_extract_message_reply_test_3() {
    let full_email = include_str!("testdata/test-3/full.html");
    let expected_reply = include_str!("testdata/test-3/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-3");
}

/// gmail selectors WITHOUT a gmail_attr div within them should not be split off
#[test]
fn test_extract_message_reply_test_4() {
    let full_email = include_str!("testdata/test-4/full.html");
    let expected_reply = include_str!("testdata/test-4/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-4");
}

/// Outlook mobile (and Outlook on the web) separate the quote with a plain
/// `<hr>` plus `div#divRplyFwdMsg`. A `border-top` header further down is a
/// nested quote and must not be the cut.
#[test]
fn outlook_mobile_reply_cuts_at_the_horizontal_rule() {
    let full_email = r#"
<div>Hi Madalyn – hope you had a great weekend!</div>
<div id="ms-outlook-mobile-body-separator-line"><div><br></div></div>
<div id="ms-outlook-mobile-signature">
<div>Eric Siegel</div>
<div>732.615.8506</div>
</div>
<hr style="display:inline-block;width:98%" tabindex="-1">
<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif"><b>From:</b> Eric Siegel &lt;es@example.com&gt;<br>
<b>Sent:</b> Thursday, 22 October 2026 11:57:19<br>
<b>To:</b> Madalyn Gibbons &lt;madalyn@example.com&gt;<br>
<b>Subject:</b> RE: Renewal</font>
<div>&nbsp;</div>
</div>
<div>
<p>Quoted body that must be removed.</p>
<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in">
<p><b>From:</b> Older Sender<br><b>Sent:</b> Monday<br><b>To:</b> Eric<br><b>Subject:</b> Older</p>
</div>
<p>Even older quoted body.</p>
</div>
"#;
    let sanitized = crate::sanitize_email_html(full_email);
    let reply =
        compute_body_replyless(Some("Re: Renewal"), Some(&sanitized), None).expect("html body");

    assert!(
        reply.contains("hope you had a great weekend"),
        "reply was dropped: {reply}"
    );
    assert!(
        reply.contains("732.615.8506"),
        "signature was dropped: {reply}"
    );
    assert!(
        !reply.to_ascii_lowercase().contains("<hr"),
        "horizontal rule was kept: {reply}"
    );
    assert!(
        !reply.contains("divRplyFwdMsg"),
        "reply header was kept: {reply}"
    );
    assert!(
        !reply.contains("Quoted body"),
        "quoted thread was kept: {reply}"
    );
    assert!(
        !reply.contains("Even older"),
        "nested quote was kept: {reply}"
    );
}

/// Outlook sometimes centers the rule in a div immediately before the header.
#[test]
fn outlook_reply_cuts_at_a_wrapped_horizontal_rule() {
    let full_email = r#"
<div>New reply</div>
<div align="center" style="text-align:center"><hr size="2" width="98%" align="center"></div>
<div id="divRplyFwdMsg"><b>From:</b> A<br><b>Sent:</b> Tue<br><b>To:</b> B<br><b>Subject:</b> C</div>
<div>Quoted thread</div>
"#;
    let reply = compute_body_replyless(None, Some(full_email), None).expect("html body");

    assert!(reply.contains("New reply"), "{reply}");
    assert!(!reply.to_ascii_lowercase().contains("<hr"), "{reply}");
    assert!(!reply.contains("Quoted thread"), "{reply}");
}

/// The same header without a rule still starts the quote.
#[test]
fn outlook_reply_header_without_a_rule_is_the_cut() {
    let full_email = r#"
<div>New reply</div>
<div id="divRplyFwdMsg"><b>From:</b> A<br><b>Sent:</b> Tue<br><b>To:</b> B<br><b>Subject:</b> C</div>
<p>Quoted thread</p>
"#;
    let reply = compute_body_replyless(None, Some(full_email), None).expect("html body");

    assert!(reply.contains("New reply"), "{reply}");
    assert!(!reply.contains("Quoted thread"), "{reply}");
    assert!(!reply.contains("divRplyFwdMsg"), "{reply}");
}

/// A rule that is part of the reply stays when it does not introduce a quote.
#[test]
fn horizontal_rule_inside_the_reply_is_kept() {
    let html = "<div>See the break</div><hr><div>More of the reply</div>";
    let reply = compute_body_replyless(None, Some(html), None).expect("html body");

    assert!(reply.to_ascii_lowercase().contains("<hr"), "{reply}");
    assert!(reply.contains("More of the reply"), "{reply}");
}

#[test]
fn plaintext_cuts_at_outlook_underscore_separator() {
    let text = "See you then.\n\nEric\n________________________________\nFrom: Eric <e@example.com>\nSent: Thursday\n\nOlder note";
    assert_eq!(
        compute_body_replyless(None, None, Some(text)).as_deref(),
        Some("See you then.\n\nEric")
    );
}

#[test]
fn plaintext_keeps_underscore_lines_that_are_not_reply_separators() {
    let text = "Intro\n__________\nStill the message";
    assert_eq!(
        compute_body_replyless(None, None, Some(text)).as_deref(),
        Some(text)
    );
}

/// the entire email (including style tags before the body) should be used if no splitter
/// is found on the email
#[test]
fn test_extract_message_reply_test_5() {
    let full_email = include_str!("testdata/test-5/full.html");
    let expected_reply = include_str!("testdata/test-5/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-5");
}

fn test_email_extraction(full_email: &str, expected_reply: &str, test_name: &str) {
    let body_replyless = compute_body_replyless(None, Some(full_email), None);

    assert_eq!(
        body_replyless
            .unwrap()
            .replace(" ", "")
            .replace("\n", "")
            .trim(),
        expected_reply.replace(" ", "").replace("\n", "").trim(),
        "Test '{}' failed: extracted reply doesn't match expected",
        test_name
    );
}

const NNBSP: &str = "\u{202f}";

/// Superhuman-style reply: the attribution shares an element with the reply
/// text, and Gmail-style times use a narrow no-break space before PM. Cutting
/// at the shared element dropped the whole reply.
#[test]
fn attribution_sharing_an_element_with_the_reply_keeps_the_reply() {
    let html = format!(
        r#"<div>Sorry for the slow reply, that works. See you then!<br><br>On Thu, Oct 29, 2026 at 7:22{NNBSP}PM, Curtis &lt;<a href="mailto:c@example.com">c@example.com</a>&gt; wrote:<br></div><blockquote><div>Hey all, just checking in.</div></blockquote><div>--<br><b>Jacob</b></div>"#
    );
    let sanitized = crate::sanitize_email_html(&html);
    let reply = compute_body_replyless(Some("Re: visit"), Some(&sanitized), None).expect("html");

    assert!(reply.contains("See you then!"), "{reply}");
    assert!(!reply.contains("wrote:"), "{reply}");
    assert!(!reply.contains("checking in"), "{reply}");
    assert!(!reply.contains("Jacob"), "{reply}");
}

/// The same text node can hold both the reply and the attribution.
#[test]
fn attribution_inside_the_reply_text_node_is_cut_mid_node() {
    let html = "<div>See you then! On Mon, Oct 26, 2026 at 9:58 AM Curtis &lt;c@example.com&gt; wrote: older</div>";
    let reply = compute_body_replyless(None, Some(html), None).expect("html");

    assert_eq!(reply, "See you then!");
}

#[test]
fn attribution_with_narrow_no_break_space_cuts_at_the_header() {
    let html = format!(
        r#"<p>Works for me.</p><p>On Wed, Oct 28, 2026 at 12:09{NNBSP}PM Curtis &lt;c@example.com&gt; wrote:</p><blockquote>Let's do 3pm?</blockquote>"#
    );
    let reply = compute_body_replyless(None, Some(&html), None).expect("html");

    assert_eq!(reply, "<p>Works for me.</p>");
}

/// Apple Mail writes "On Oct 29, 2026, at 19:22, Name <addr> wrote:".
#[test]
fn apple_mail_attribution_without_a_blockquote_is_cut() {
    let html = "<div>Sounds good.</div><div>On Oct 29, 2026, at 19:22, Curtis &lt;c@example.com&gt;\nwrote:</div><div>Older</div>";
    let reply = compute_body_replyless(None, Some(html), None).expect("html");

    assert_eq!(reply, "<div>Sounds good.</div>");
}

/// A splitter that wraps the reply would leave nothing; a later one is used.
#[test]
fn a_cut_that_empties_the_reply_falls_through() {
    let html = r#"<div style="border:1px solid">Reply text<div>From: a<br>Sent: b<br>To: c<br>Subject: d</div><blockquote>Quoted</blockquote></div>"#;
    let reply = compute_body_replyless(None, Some(html), None).expect("html");

    assert!(reply.contains("Reply text"), "{reply}");
    assert!(!reply.contains("Quoted"), "{reply}");
}

/// Kept text nodes are re-escaped rather than emitted as markup.
#[test]
fn kept_text_stays_escaped() {
    let html = "Use &lt;b&gt; tags<blockquote>Quoted</blockquote>";
    let reply = compute_body_replyless(None, Some(html), None).expect("html");

    assert_eq!(reply, "Use &lt;b&gt; tags");
}

#[test]
fn plaintext_cuts_at_a_wrapped_attribution() {
    let text = "See you then!\n\nOn Thu, Oct 29, 2026 at 7:22 PM, Curtis <c@example.com>\nwrote:\n\n> Hey all";
    assert_eq!(
        compute_body_replyless(None, None, Some(text)).as_deref(),
        Some("See you then!")
    );
}
