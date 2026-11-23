use strum::IntoEnumIterator;

use super::*;

const HEADER: &str = "                   rd sg wr se de sm so cm co au ag eg in pu";

/// The whole table, under [`HEADER`]: one row per caller, one column per
/// category in declaration order. `.` allows, `R` refuses now, `o` refuses
/// in observe mode only.
const TABLE: &str = "
person             .  .  .  .  .  .  .  .  .  .  .  .  o  .
api_credential     .  .  .  .  .  .  .  o  o  o  o  .  o  .
program            .  .  .  .  .  .  o  R  R  R  R  o  R  .
scoped_no_send     .  .  .  o  o  o  o  R  R  R  R  o  R  .
scoped_generation  .  .  o  o  o  o  o  R  R  R  R  o  R  .
scoped_dry_run     .  o  o  o  o  o  o  R  R  R  R  o  R  .
scoped_unknown     .  o  o  o  o  o  o  R  R  R  R  o  R  .
channel_mention    .  .  .  o  o  o  o  R  R  R  R  o  R  .
account_manager    .  .  .  .  .  .  .  R  R  R  R  .  R  .
bot                .  .  .  .  .  .  o  o  o  o  o  .  o  .
harness            .  .  .  .  .  .  o  o  o  o  o  .  o  .
internal           .  .  .  .  .  .  .  .  .  .  .  .  .  .
";

#[test]
fn every_caller_and_category_is_decided_by_the_table() {
    let mut rendered = format!("{HEADER}\n");
    for caller in Caller::iter() {
        let cells: Vec<&str> = Category::iter()
            .map(|category| match decide(caller, category) {
                Ok(()) => ".",
                Err(Refusal {
                    enforcement: Enforcement::Enforced,
                    ..
                }) => "R",
                Err(Refusal {
                    enforcement: Enforcement::Observed,
                    ..
                }) => "o",
            })
            .collect();
        rendered.push_str(&format!("{:<19}{}\n", caller.to_string(), cells.join("  ")));
    }
    assert_eq!(rendered, format!("{HEADER}{TABLE}"));
}

#[test]
fn a_refusal_names_its_rule_and_tells_the_caller_who_must_do_it_instead() {
    let refusal = decide(Caller::Program, Category::CredentialMint).unwrap_err();
    assert_eq!(
        refusal,
        Refusal {
            code: RefusalCode::PersonOnly,
            category: Category::CredentialMint,
            caller: Caller::Program,
            enforcement: Enforcement::Enforced,
        }
    );
    assert_eq!(
        refusal.message(),
        "An agent's program can't create credentials or bearer links. Ask the person to do it themselves in Macro."
    );

    let refusal = decide(Caller::Bot, Category::ShareOutside).unwrap_err();
    assert_eq!(
        refusal,
        Refusal {
            code: RefusalCode::PersonOnly,
            category: Category::ShareOutside,
            caller: Caller::Bot,
            enforcement: Enforcement::Observed,
        }
    );
    assert_eq!(
        refusal.message(),
        "A bot can't share beyond the team or change who belongs. Ask the person to do it themselves in Macro."
    );

    let refusal = decide(Caller::AccountManager, Category::AuthChange).unwrap_err();
    assert_eq!(refusal.code, RefusalCode::PersonOnly);
    assert_eq!(
        refusal.message(),
        "An account manager can't change who can sign in to or control the account. Ask the account holder to do it themselves in Macro."
    );

    let refusal = decide(Caller::ApiCredential, Category::Connect).unwrap_err();
    assert_eq!(
        refusal,
        Refusal {
            code: RefusalCode::SignInRequired,
            category: Category::Connect,
            caller: Caller::ApiCredential,
            enforcement: Enforcement::Observed,
        }
    );
    assert_eq!(
        refusal.message(),
        "This credential can't connect accounts, devices or endpoints. The person must sign in to Macro and do it there."
    );

    let refusal = decide(Caller::ScopedNoSend, Category::Send).unwrap_err();
    assert_eq!(refusal.code, RefusalCode::OutOfScope);
    assert_eq!(
        refusal.message(),
        "This session can't send to or notify other people."
    );

    let refusal = decide(Caller::Person, Category::Internal).unwrap_err();
    assert_eq!(
        refusal,
        Refusal {
            code: RefusalCode::InternalOnly,
            category: Category::Internal,
            caller: Caller::Person,
            enforcement: Enforcement::Observed,
        }
    );
    assert_eq!(
        refusal.message(),
        "Only Macro's own services can call internal routes."
    );
}

#[test]
fn a_category_set_holds_every_category_and_only_those_added() {
    let mut set = CategorySet::default();
    for category in Category::iter() {
        assert!(!set.contains(category), "{category}");
        set = set.with(category);
        assert!(set.contains(category), "{category}");
    }
    let only_last = CategorySet::default().with(Category::Public);
    assert!(only_last.contains(Category::Public));
    assert!(!only_last.contains(Category::Read));
}

#[test]
fn a_channel_mention_is_a_program_that_may_not_send_or_fetch() {
    use Category as C;
    for category in [
        C::Send,
        C::Delegate,
        C::ShareMember,
        C::ShareOutside,
        C::Egress,
    ] {
        assert!(
            decide(Caller::ChannelMention, category).is_err(),
            "{category}"
        );
    }
    for category in [C::Read, C::Suggest, C::Write] {
        assert!(
            decide(Caller::ChannelMention, category).is_ok(),
            "{category}"
        );
    }
    assert!(Caller::ChannelMention.is_program());
    assert_eq!(
        decide(Caller::Program, Category::Egress)
            .unwrap_err()
            .enforcement,
        Enforcement::Observed
    );
}
