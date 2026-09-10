use super::*;

const TABLE: &str = "\
    1     0 /sbin/launchd
  400     1 /usr/sbin/sshd
  500   400 /opt/homebrew/bin/fish
  600   500 /Users/eric/.cargo/bin/macrod
  601   600 /usr/local/bin/claude
  602   600 pbcopy
  700     1 ps
";

#[test]
fn children_reads_only_the_direct_children() {
    assert_eq!(
        children(TABLE, 600),
        vec![(601, "claude".to_owned()), (602, "pbcopy".to_owned())]
    );
}

#[test]
fn pick_finds_the_child_named_like_the_command() {
    let found = pick(children(TABLE, 600), "/usr/local/bin/claude");
    assert_eq!(found, Some((601, "claude".to_owned())));
}

#[test]
fn pick_takes_a_lone_child_whatever_its_name() {
    let found = pick(vec![(900, "node".to_owned())], "npx");
    assert_eq!(found, Some((900, "node".to_owned())));
}

#[test]
fn pick_names_nothing_when_ambiguous() {
    let ambiguous = vec![(900, "node".to_owned()), (901, "pbcopy".to_owned())];
    assert_eq!(pick(ambiguous, "npx"), None);
}
