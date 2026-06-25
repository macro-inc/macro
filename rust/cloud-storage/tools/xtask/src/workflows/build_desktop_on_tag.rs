//! `Build Desktop on Tag` — orchestrator workflow that triggers AppImage and DMG
//! builds in parallel when a release tag is pushed. Also supports manual
//! dispatch. Generated into `build_desktop_on_tag.yml`.
//!
//! The actual build logic lives in the reusable workflows defined in
//! [`super::build_appimage_on_tag`] and [`super::build_dmg_on_tag`].
//!
//! This workflow is rendered by hand because `gh-workflow` 0.8's `Job` struct
//! cannot represent reusable-workflow calling jobs (`with:` +
//! `secrets: inherit`), and we don't want to add a direct YAML serializer
//! dependency to `xtask` just for this one workflow.

use crate::workflows::build_appimage_on_tag;

/// Build the workflow YAML body.
pub fn build_desktop_on_tag() -> String {
    format!(
        indoc::indoc! {r#"
            name: Build Desktop on Tag
            'on':
              push:
                tags:
                - {desktop_tag_pattern}
              create: {{}}
              workflow_dispatch:
                inputs:
                  ref:
                    description: Release tag to build (v* or refs/tags/v*). Defaults to the selected protected ref or release tag.
                    required: false
                    type: string
            concurrency:
              group: desktop-${{{{ inputs.ref || (github.event.ref_type == 'tag' && github.event.ref || github.ref_name) }}}}
              cancel-in-progress: true
            jobs:
              resolve-ref:
                if: github.event_name == 'workflow_dispatch' || github.event_name == 'push' || (github.event_name == 'create' && github.event.ref_type == 'tag')
                name: Resolve build ref
                runs-on: ubuntu-latest
                outputs:
                  ref: ${{{{ steps.resolve.outputs.ref }}}}
                steps:
                - id: resolve
                  name: Resolve ref
                  run: |
            {resolve_ref_script}
                  shell: bash
                  env:
                    EVENT_NAME: ${{{{ github.event_name }}}}
                    INPUT_REF: ${{{{ inputs.ref }}}}
                    GITHUB_EVENT_REF: ${{{{ github.event.ref }}}}
                    GITHUB_EVENT_REF_TYPE: ${{{{ github.event.ref_type }}}}
                    SELECTED_REF: ${{{{ github.ref }}}}
                    SELECTED_REF_NAME: ${{{{ github.ref_name }}}}
                    SELECTED_REF_PROTECTED: ${{{{ github.ref_protected }}}}
              build-appimage:
                needs:
                - resolve-ref
                uses: './.github/workflows/build_appimage_on_tag.yml'
                with:
                  ref: ${{{{ needs.resolve-ref.outputs.ref }}}}
                secrets: inherit
              build-dmg:
                needs:
                - resolve-ref
                uses: './.github/workflows/build_dmg_on_tag.yml'
                with:
                  ref: ${{{{ needs.resolve-ref.outputs.ref }}}}
                secrets: inherit
        "#},
        desktop_tag_pattern = build_appimage_on_tag::DESKTOP_TAG_PATTERN,
        resolve_ref_script = indent(include_str!("scripts/resolve_desktop_ref.sh"), 8),
    )
}

fn indent(value: &str, spaces: usize) -> String {
    let prefix = " ".repeat(spaces);
    value
        .lines()
        .map(|line| {
            if line.is_empty() {
                String::new()
            } else {
                format!("{prefix}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
