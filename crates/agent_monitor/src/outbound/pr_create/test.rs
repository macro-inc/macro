use super::invokes_pr_create;

#[test]
fn a_command_that_runs_gh_pr_create_counts() {
    for command in [
        "gh pr create --fill",
        "  gh   pr create",
        "git push -u origin feat/x && gh pr create --title \"perf: x\" --body-file /tmp/b.md",
        "cargo test; gh pr create --draft",
        "true || gh pr create",
        "echo body | gh pr create --body-file -",
        "cd repo\ngh pr create --fill",
        "GH_TOKEN=x env gh pr create",
        "/usr/bin/gh pr create --fill",
        "url=$(gh pr create --fill) && echo \"$url\"",
        "url=\"$(gh pr create --fill)\"",
        "(cd repo && gh pr create)",
        "gh pr create --body-file - <<'EOF'\nWhy: things\nEOF",
        "cat <<EOF > /tmp/b.md\nbody\nEOF\ngh pr create --body-file /tmp/b.md",
    ] {
        assert!(invokes_pr_create(command), "{command:?}");
    }
}

#[test]
fn a_command_that_only_mentions_gh_pr_create_does_not() {
    for command in [
        "grep -rn \"gh pr create\" src",
        "grep -rn 'gh pr create' src",
        "echo gh pr create",
        "rg gh pr create",
        "gh pr view 42",
        "gh pr edit 7 --add-label ready",
        "herdr-guy builder --name x \"fix it, then gh pr create\"",
        "cat <<EOF > task.md\nrun tests\ngh pr create --fill\nEOF",
        "cat <<-'DONE'\n\tgh pr create\n\tDONE\necho ok",
        "# gh pr create later\ncargo test",
        "echo \"x\\\"; gh pr create\"",
        "ghx pr create",
        "gh pr creates",
    ] {
        assert!(!invokes_pr_create(command), "{command:?}");
    }
}
