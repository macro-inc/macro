use super::*;
use crate::{EditorType, NodeClock, nodes::*, surface};
use lexical_rich_nodes::link::LinkNode;
use serde_json::json;
use std::sync::Arc;

#[test]
fn code_paste_keeps_markdown_urls_themes_and_tabs_verbatim_but_defers_files() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("rust"))?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(code)?;
        Ok(code.key())
    })?;
    let text = "**bold**\n\thttps://github.com/example/repository/pull/12";
    let mut payload = ClipboardPayload::default();
    payload.data.insert("text/plain".into(), text.into());
    assert_eq!(
        editor.dispatch(&Command::Paste(payload.clone()))?.0,
        Handled::Yes
    );
    assert_eq!(editor.state().view().text_content(code), text);
    assert!(
        editor
            .state()
            .view()
            .nodes_of_type::<PullRequestMentionNode>()
            .is_empty()
    );
    payload.has_files = true;
    let (_, commit) = editor.dispatch(&Command::Paste(payload))?;
    assert_eq!(editor.state().view().text_content(code), text);
    assert_eq!(
        commit.events.first().expect("file request").name(),
        "group-b.file-paste"
    );
    Ok(())
}

#[test]
fn pr_lookup_upgrades_only_the_unchanged_placeholder_and_is_safe_to_redeliver() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)
    })?;
    let mut payload = ClipboardPayload::default();
    payload.data.insert(
        "text/plain".into(),
        " https://github.com/example/repository/pull/12/files?test=1 ".into(),
    );
    let (_, commit) = editor.dispatch(&Command::Paste(payload.clone()))?;
    let request = surface::event_payload(commit.events.first().expect("lookup"))?.expect("payload");
    let generation = request
        .get("generation")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .expect("generation");
    let json = json!({"request":request, "id":"fixture-pr"}).to_string();
    let stale =
        decode_command("group-b.resolve-pr", &json, generation + 1, None)?.expect("command");
    assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
    let command = decode_command("group-b.resolve-pr", &json, generation, None)?.expect("command");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::HistoryMerge));
    let state = editor.state().view();
    let keys = state.nodes_of_type::<PullRequestMentionNode>();
    let mention = state
        .get::<PullRequestMentionNode>(*keys.first().expect("mention"))
        .expect("payload");
    assert_eq!(mention.label.as_deref(), Some("example/repository#12"));
    assert_eq!(
        mention.url.as_deref(),
        Some("https://github.com/example/repository/pull/12")
    );
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    editor.update(|tx| tx.select_end(NodeKey::ROOT))?;
    let (_, commit) = editor.dispatch(&Command::Paste(payload))?;
    let request = surface::event_payload(commit.events.first().expect("lookup"))?.expect("payload");
    let link = *editor
        .state()
        .view()
        .nodes_of_type::<LinkNode>()
        .first()
        .expect("link");
    editor.update(|tx| {
        tx.get_mut::<LinkNode>(link)?.url = "https://example.com/changed".into();
        Ok(())
    })?;
    let command = decode_command(
        "group-b.resolve-pr",
        &json!({"request":request,"id":"other-pr"}).to_string(),
        generation,
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(
        editor
            .state()
            .view()
            .nodes_of_type::<PullRequestMentionNode>()
            .len(),
        1
    );
    Ok(())
}

#[test]
fn app_paste_checks_host_aliases_params_and_uses_the_authored_mention_clock() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeClock(Arc::new(|| 1234)))
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)
    })?;
    let mut payload = ClipboardPayload::default();
    payload.data.insert("text/plain".into(), "https://macro.com/app/agents/00000000-0000-0000-0000-000000000001?a=first&referral_code=omit&__proto__=ignored&a=last".into());
    payload.data.insert(
        "application/x-macro-text-paste".into(),
        json!({"hostname":"tauri.localhost","nativeHost":true}).to_string(),
    );
    assert_eq!(editor.dispatch(&Command::Paste(payload))?.0, Handled::Yes);
    let state = editor.state().view();
    let key = *state
        .nodes_of_type::<DocumentMentionNode>()
        .first()
        .expect("mention");
    let mention = state.get::<DocumentMentionNode>(key).expect("payload");
    assert_eq!(mention.block_name.as_deref(), Some("agent"));
    assert_eq!(mention.created_at, Maybe::Value(1234));
    assert_eq!(
        mention.block_params,
        indexmap::IndexMap::from([("a".to_owned(), "last".to_owned())])
    );
    assert!(
        text_paste::urls::parse_app(
            "https://macro.www.com/app/md/00000000-0000-0000-0000-000000000001",
            "macro.com",
            false
        )
        .is_none()
    );
    Ok(())
}

#[test]
fn large_paste_uses_utf16_threshold_and_never_collapses_an_expanded_selection() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("replace me")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(text.key())
    })?;
    let mut payload = ClipboardPayload::default();
    payload.data.insert("text/plain".into(), "😀".repeat(751));
    assert_eq!(
        editor.dispatch(&Command::Paste(payload.clone()))?.0,
        Handled::Yes
    );
    assert_eq!(editor.state().view().nodes_of_type::<PasteNode>().len(), 1);
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(0)),
            Point::text(text, Utf16Offset(7)),
        ))))
    })?;
    editor.dispatch(&Command::Paste(payload))?;
    assert_eq!(editor.state().view().nodes_of_type::<PasteNode>().len(), 1);
    Ok(())
}
