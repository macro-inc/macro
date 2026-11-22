//! Slice (B): every inventoried kind's Source-written stored map (all-kinds
//! probe log 8672bafb, diffFromEmpty rows, rebuilt per node id) loads through
//! the real Loro reader path (reconstruct_initial_state, the builder's
//! initial_state, strict attach), and each stored null is held exactly as the
//! native model can: TRI fields keep the null; the named model gaps
//! (C-NULL-MODEL-*) hold it absent; a text kind's null mode imports as absent,
//! as in Source (slice A). Element direction and a comment-mark's indent are
//! Source's raw nulls.
use lexical_loro::{LoroProjection, mirror, new_doc, reconstruct_initial_state};
use lexical_model::*;
use macro_document_model::{Result, headless_builder, sync::MACRO_SYNC_POLICY};
use serde_json::Value;

/// Per stored key: (key, kept as null).
type KeyRows = &'static [(&'static str, bool)];
/// Per node id: (id, its key rows).
type NodeRows = &'static [(&'static str, KeyRows)];
/// (kind, stored root JSON, per node id rows).
const CASES: &[(&str, &str, NodeRows)] = &[
    (
        "await",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0001"},"type":"await","awaitId":"await-1","inline":true,"text":null,"version":1}]}]}"#,
        &[("kind0001", &[("text", true)])],
    ),
    (
        "booking-link-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0002"},"label":null,"profileId":null,"slug":null,"type":"booking-link-mention","version":1,"url":"https://example.com/b"}]}]}"#,
        &[(
            "kind0002",
            &[("label", true), ("profileId", true), ("slug", true)],
        )],
    ),
    (
        "classed-block",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0003"},"classes":[],"attributes":null,"tag":"div","direction":null,"indent":0,"type":"classed-block","version":1,"format":"","children":[{"$":{"id":"kp000003"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"kt000003"},"text":"c","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]}]}]}"#,
        &[
            ("kind0003", &[("attributes", false), ("direction", true)]),
            ("kp000003", &[("direction", true)]),
        ],
    ),
    (
        "comment-mark",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0004"},"ids":["thread-1"],"threadId":null,"isDraft":false,"direction":null,"indent":null,"type":"comment-mark","version":1,"format":"","children":[{"$":{"id":"kt000004"},"text":"c","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]}]}]}"#,
        &[(
            "kind0004",
            &[("threadId", true), ("direction", true), ("indent", true)],
        )],
    ),
    (
        "contact-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0005"},"mentionUuid":null,"name":"Name","contactId":"contact-1","emailOrDomain":null,"type":"contact-mention","version":1,"isCompany":null}]}]}"#,
        &[(
            "kind0005",
            &[
                ("mentionUuid", true),
                ("emailOrDomain", true),
                ("isCompany", true),
            ],
        )],
    ),
    (
        "date-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0006"},"displayFormat":"MMM d","type":"date-mention","version":1,"date":"2026-01-01T00:00:00.000Z","mentionUuid":null}]}]}"#,
        &[("kind0006", &[("mentionUuid", true)])],
    ),
    (
        "document-card",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0007"},"blockName":"md","mentionUuid":null,"previewData":null,"previewBox":["100%","400px"],"type":"document-card","blockParams":{},"version":1,"documentId":"doc-1","documentName":"Doc"}]}"#,
        &[("kind0007", &[("mentionUuid", true), ("previewData", true)])],
    ),
    (
        "document-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0008"},"blockName":"md","createdAt":1794629622379,"documentName":"Doc","mentionUuid":null,"channelType":null,"blockParams":{},"type":"document-mention","version":2,"documentId":"doc-1","collapsed":false}]}]}"#,
        &[("kind0008", &[("mentionUuid", true), ("channelType", true)])],
    ),
    (
        "html-render",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0009"},"adaptColors":null,"type":"html-render","version":1,"html":"<p>x</p>"}]}"#,
        &[("kind0009", &[("adaptColors", true)])],
    ),
    (
        "image",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0010"},"constrainedHeight":null,"width":10,"alt":"","scale":1,"constrainedWidth":null,"id":"img-1","type":"image","version":1,"height":10,"srcType":"url","url":"https://example.com/i.png"}]}"#,
        &[(
            "kind0010",
            &[("constrainedHeight", true), ("constrainedWidth", true)],
        )],
    ),
    (
        "video",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0011"},"constrainedHeight":null,"width":10,"scale":1,"constrainedWidth":null,"id":"vid-1","type":"video","version":1,"height":10,"srcType":"url","controls":true,"url":"https://example.com/v.mp4"}]}"#,
        &[(
            "kind0011",
            &[("constrainedHeight", true), ("constrainedWidth", true)],
        )],
    ),
    (
        "pr-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0012"},"label":null,"type":"pr-mention","url":null,"version":1,"id":"macro-inc/macro#1","mentionUuid":null}]}]}"#,
        &[(
            "kind0012",
            &[("label", true), ("url", false), ("mentionUuid", true)],
        )],
    ),
    (
        "snapshot",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0013"},"blockName":"md","mentionUuid":null,"snapshotDate":"2026-11-14T04:13:42.404Z","type":"snapshot","version":1,"content":null,"documentId":"doc-1","documentName":"Doc"}]}"#,
        &[("kind0013", &[("mentionUuid", true), ("content", true)])],
    ),
    (
        "tag-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0014"},"propertyDefinitionId":null,"color":null,"name":"tag","scope":null,"type":"tag-mention","version":1,"optionId":null}]}]}"#,
        &[(
            "kind0014",
            &[
                ("propertyDefinitionId", true),
                ("color", true),
                ("scope", true),
                ("optionId", true),
            ],
        )],
    ),
    (
        "user-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0015"},"displayName":"user","type":"user-mention","email":"user@example.com","version":1,"userId":"user-1","mentionUuid":null}]}]}"#,
        &[("kind0015", &[("mentionUuid", true)])],
    ),
    (
        "agent-session-mention",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0016"},"label":null,"type":"agent-session-mention","version":3,"id":"session-1","mentionUuid":null}]}]}"#,
        &[("kind0016", &[("label", true), ("mentionUuid", true)])],
    ),
    (
        "custom-code",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0017"},"previewEnabled":false,"theme":null,"direction":null,"indent":0,"language":null,"type":"custom-code","format":"","version":1,"children":[{"$":{"id":"kh000017"},"text":"x","highlightType":null,"style":null,"type":"code-highlight","version":1,"format":0,"mode":null,"detail":null}]}]}"#,
        &[
            (
                "kind0017",
                &[("theme", false), ("direction", true), ("language", false)],
            ),
            (
                "kh000017",
                &[
                    ("highlightType", false),
                    ("style", true),
                    ("mode", false),
                    ("detail", true),
                ],
            ),
        ],
    ),
    (
        "listitem",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0018"},"start":1,"tag":"ul","direction":null,"indent":0,"listType":"bullet","type":"list","format":"","version":1,"children":[{"$":{"id":"kl000018"},"checked":null,"value":1,"direction":null,"indent":0,"type":"listitem","version":1,"format":"","children":[{"$":{"id":"kt000018"},"text":"c","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]}]}]}"#,
        &[
            ("kind0018", &[("direction", true)]),
            ("kl000018", &[("checked", false), ("direction", true)]),
        ],
    ),
    (
        "table",
        r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]},{"$":{"id":"kind0019"},"frozenColumnCount":null,"rowStriping":null,"colWidths":null,"frozenRowCount":null,"direction":null,"indent":0,"type":"table","version":1,"format":"","children":[{"$":{"id":"kr000019"},"direction":null,"indent":0,"type":"tablerow","version":1,"format":"","children":[{"$":{"id":"kc000019"},"backgroundColor":null,"colSpan":1,"version":1,"width":null,"direction":null,"indent":0,"rowSpan":1,"type":"tablecell","format":"","headerState":0,"children":[{"$":{"id":"kp000019"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"kt000019"},"text":"c","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]}]}]}]}]}"#,
        &[
            (
                "kind0019",
                &[
                    ("frozenColumnCount", false),
                    ("rowStriping", false),
                    ("colWidths", true),
                    ("frozenRowCount", false),
                    ("direction", true),
                ],
            ),
            ("kr000019", &[("direction", true)]),
            (
                "kc000019",
                &[
                    ("backgroundColor", true),
                    ("width", false),
                    ("direction", true),
                ],
            ),
            ("kp000019", &[("direction", true)]),
        ],
    ),
];

fn node_by_id(view: StateRef<'_>, id: &str) -> Option<NodeKey> {
    lexical_rich_nodes::utils::dfs(view, None, None)
        .into_iter()
        .map(|entry| entry.node)
        .find(|key| {
            view.export_json(*key)
                .ok()
                .and_then(|json| json.get("$").and_then(|state| state.get("id")).cloned())
                == Some(Value::String(id.to_owned()))
        })
}

#[test]
fn every_kinds_source_stored_nulls_load_through_the_real_loro_reader_path() -> Result<()> {
    for (kind, stored, expected) in CASES {
        let doc = new_doc(7)?;
        let root: Value = serde_json::from_str(stored)?;
        mirror::set_state(&doc, &root)?;
        let initial = reconstruct_initial_state(&doc, &MACRO_SYNC_POLICY)?;
        let editor = headless_builder().initial_state(initial.state).build()?;
        LoroProjection::attach(&doc, editor.state(), &MACRO_SYNC_POLICY)
            .unwrap_or_else(|error| panic!("{kind}: attach {error}"));
        let view = editor.state().view();
        for (id, keys) in *expected {
            let key = node_by_id(view, id).unwrap_or_else(|| panic!("{kind}: node {id}"));
            let own = view.export_json(key)?;
            for (name, kept) in *keys {
                if *kept {
                    assert_eq!(own.get(*name), Some(&Value::Null), "{kind} {id} {name}");
                } else {
                    assert!(!own.contains_key(*name), "{kind} {id} {name} (named gap)");
                }
            }
        }
    }
    Ok(())
}
