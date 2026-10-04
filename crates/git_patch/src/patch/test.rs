use super::*;

const MODIFIED: &str = "\
diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,4 +1,5 @@
 fn main() {
-    println!(\"hi\");
+    println!(\"hello\");
+    println!(\"world\");
 }
";

const ADDED: &str = "\
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,2 @@
+# Title
+text
";

const DELETED: &str = "\
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-forever
";

const RENAMED_PURE: &str = "\
diff --git a/a/before.rs b/b/after.rs
similarity index 100%
rename from a/before.rs
rename to b/after.rs
";

const RENAMED_CHANGED: &str = "\
diff --git a/before.rs b/after.rs
similarity index 90%
rename from before.rs
rename to after.rs
index 5555555..6666666 100644
--- a/before.rs
+++ b/after.rs
@@ -1 +1 @@
-old
+new
";

const BINARY: &str = "\
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/logo.png differ
";

#[test]
fn a_modified_file_counts_its_lines() {
    let files = parse_git_patch(MODIFIED);
    assert_eq!(files.len(), 1);
    let file = &files[0].file;
    assert_eq!(file.path, "src/lib.rs");
    assert_eq!(file.kind, FileChangeKind::Modified);
    assert_eq!((file.additions, file.deletions), (2, 1));
    assert!(!file.binary);
    assert_eq!(files[0].text, MODIFIED.trim_end());
}

#[test]
fn added_and_deleted_files_are_told_apart_by_dev_null_and_modes() {
    let files = parse_git_patch(&format!("{ADDED}{DELETED}"));
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].file.path, "docs/new.md");
    assert_eq!(files[0].file.kind, FileChangeKind::Added);
    assert_eq!((files[0].file.additions, files[0].file.deletions), (2, 0));
    assert_eq!(files[1].file.path, "old.txt");
    assert_eq!(files[1].file.kind, FileChangeKind::Deleted);
    assert_eq!((files[1].file.additions, files[1].file.deletions), (0, 2));
}

#[test]
fn renames_keep_the_previous_path_with_or_without_hunks() {
    let files = parse_git_patch(&format!("{RENAMED_PURE}{RENAMED_CHANGED}"));
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].file.kind, FileChangeKind::Renamed);
    assert_eq!(files[0].file.path, "b/after.rs");
    assert_eq!(files[0].file.previous_path.as_deref(), Some("a/before.rs"));
    assert_eq!((files[0].file.additions, files[0].file.deletions), (0, 0));
    assert_eq!(files[1].file.kind, FileChangeKind::Renamed);
    assert_eq!(files[1].file.path, "after.rs");
    assert_eq!(files[1].file.previous_path.as_deref(), Some("before.rs"));
    assert_eq!((files[1].file.additions, files[1].file.deletions), (1, 1));
}

#[test]
fn binary_files_are_flagged_and_carry_no_counts() {
    let files = parse_git_patch(BINARY);
    assert_eq!(files.len(), 1);
    assert!(files[0].file.binary);
    assert_eq!(files[0].file.kind, FileChangeKind::Added);
    assert_eq!(files[0].file.path, "logo.png");
    assert_eq!((files[0].file.additions, files[0].file.deletions), (0, 0));
}

#[test]
fn lines_that_look_like_headers_inside_a_hunk_are_changes() {
    let patch = "\
diff --git a/notes.md b/notes.md
index 1..2 100644
--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,2 @@
---- removed rule
++++ added rule
 kept
\\ No newline at end of file
";
    let files = parse_git_patch(patch);
    assert_eq!(files[0].file.path, "notes.md");
    assert_eq!((files[0].file.additions, files[0].file.deletions), (1, 1));
}

#[test]
fn paths_with_spaces_and_quoting_survive() {
    let patch = "\
diff --git a/with space.txt b/with space.txt
index 1..2 100644
--- a/with space.txt
+++ b/with space.txt
@@ -1 +1 @@
-a
+b
diff --git \"a/caf\\303\\251.txt\" \"b/caf\\303\\251.txt\"
new file mode 100644
--- /dev/null
+++ \"b/caf\\303\\251.txt\"
@@ -0,0 +1 @@
+x
";
    let files = parse_git_patch(patch);
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].file.path, "with space.txt");
    assert_eq!(files[1].file.path, "café.txt");
    assert_eq!(files[1].file.kind, FileChangeKind::Added);
}

#[test]
fn text_before_the_first_block_and_an_empty_patch_are_ignored() {
    assert!(parse_git_patch("").is_empty());
    assert!(parse_git_patch("\n\n").is_empty());
    let files = parse_git_patch(&format!("From abc Mon Sep 17\nSubject: x\n\n{MODIFIED}"));
    assert_eq!(files.len(), 1);
}

#[test]
fn the_budget_drops_whole_files_and_says_so() {
    let files = parse_git_patch(&format!("{MODIFIED}{ADDED}{DELETED}"));
    let small_first = files[0].text.len();
    let budgeted = budget_patch(files.clone(), small_first + 1, usize::MAX);
    assert!(budgeted.truncated);
    assert!(!budgeted.files[0].patch_omitted);
    assert!(budgeted.files[1].patch_omitted);
    assert!(budgeted.files[2].patch_omitted);
    assert_eq!(budgeted.patch.trim_end(), MODIFIED.trim_end());
    assert_eq!(budgeted.files.len(), 3, "omitted files keep their summary");

    let generous = budget_patch(files, usize::MAX, usize::MAX);
    assert!(!generous.truncated);
    assert_eq!(parse_git_patch(&generous.patch).len(), 3);
}

#[test]
fn a_single_oversized_file_is_omitted_on_its_own() {
    let files = parse_git_patch(&format!("{MODIFIED}{ADDED}"));
    let budgeted = budget_patch(files, usize::MAX, 10);
    assert!(budgeted.truncated);
    assert!(budgeted.files.iter().all(|file| file.patch_omitted));
    assert!(budgeted.patch.is_empty());
}

#[test]
fn binary_files_never_enter_the_stored_patch() {
    let files = parse_git_patch(&format!("{BINARY}{MODIFIED}"));
    let budgeted = budget_patch(files, usize::MAX, usize::MAX);
    assert!(!budgeted.truncated);
    assert!(!budgeted.files[0].patch_omitted);
    assert_eq!(parse_git_patch(&budgeted.patch).len(), 1);
    assert_eq!(totals(&budgeted.files), (2, 1));
}
