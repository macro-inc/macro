//! Native model costs on the same generated Markdown as the Chromium bulk rig.
//! WASM boundary, view reconciliation and Loro projection are measured by that rig.
use core::time::Duration;
use criterion::{BatchSize, BenchmarkId, Criterion, criterion_group, criterion_main};
use document_session::default_editor_builder;
use lexical_markdown::{
    MarkdownOptions, builtin::TRANSFORMERS, convert_from_markdown_string,
    convert_to_markdown_string,
};
use lexical_model::{EditorMode, Error};
use std::{hint::black_box, path::Path};

#[path = "support/timing_load.rs"]
mod timing_load;
use timing_load::LoadGuardedTime;

fn bulk(c: &mut Criterion<LoadGuardedTime>) {
    for size in ["small", "medium", "large"] {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/lexical-conformance/bench/docs")
            .join(format!("{size}.md"));
        let markdown = std::fs::read_to_string(path).expect("generated benchmark Markdown");
        let mut editor = default_editor_builder(EditorMode::Headless, 1)
            .build()
            .expect("editor");
        editor
            .update(|tx| {
                convert_from_markdown_string(
                    tx,
                    &markdown,
                    &TRANSFORMERS,
                    None,
                    &MarkdownOptions::default(),
                )
                .map_err(|error| Error::invariant(error.to_string()))
            })
            .expect("prepared state");
        let state = editor.state().clone();
        let json = state.to_json_string().expect("prepared JSON");
        let mut parser = default_editor_builder(EditorMode::Headless, 1)
            .build()
            .expect("parser");
        let mut group = c.benchmark_group("portable-bulk-model");
        group
            .sample_size(20)
            .warm_up_time(Duration::from_secs(1))
            .measurement_time(Duration::from_secs(3));
        group.bench_function(BenchmarkId::new("json-parse", size), |b| {
            b.iter(|| {
                black_box(
                    parser
                        .parse_editor_state_str(black_box(&json))
                        .expect("parse"),
                )
            })
        });
        group.bench_function(BenchmarkId::new("json-serialize", size), |b| {
            b.iter(|| black_box(state.to_json_string().expect("serialize")))
        });
        group.bench_function(BenchmarkId::new("markdown-export", size), |b| {
            b.iter(|| {
                black_box(
                    convert_to_markdown_string(
                        &state,
                        &TRANSFORMERS,
                        None,
                        &MarkdownOptions::default(),
                    )
                    .expect("export"),
                )
            })
        });
        group.bench_function(BenchmarkId::new("markdown-import-model", size), |b| {
            b.iter_batched(
                || {
                    let mut fresh = default_editor_builder(EditorMode::Headless, 1)
                        .build()
                        .expect("fresh editor");
                    let parsed = fresh
                        .parse_editor_state_str(&json)
                        .expect("fresh seed parse");
                    fresh
                        .set_editor_state(parsed, Default::default())
                        .expect("seed");
                    fresh
                },
                |mut fresh| {
                    fresh
                        .update(|tx| {
                            convert_from_markdown_string(
                                tx,
                                &markdown,
                                &TRANSFORMERS,
                                None,
                                &MarkdownOptions::default(),
                            )
                            .map_err(|error| Error::invariant(error.to_string()))
                        })
                        .expect("import");
                    black_box(fresh)
                },
                BatchSize::PerIteration,
            )
        });
        group.finish();
    }
}
criterion_group! { name = benches; config = Criterion::default().with_measurement(LoadGuardedTime); targets = bulk }
criterion_main!(benches);
