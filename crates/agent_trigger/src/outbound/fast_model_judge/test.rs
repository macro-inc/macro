use super::*;

#[test]
fn the_judge_is_told_what_an_image_blurb_means() {
    assert!(SYSTEM_PROMPT.contains("<this is an image of ...>"));
    assert!(SYSTEM_PROMPT.contains("<this is an image>"));
}

#[test]
fn an_image_blurb_is_part_of_the_message_being_judged() {
    let content = "see this\n<this is an image of a frog>";
    assert_eq!(
        judge_user_prompt("", content),
        "The message to judge:\nsee this\n<this is an image of a frog>"
    );
    assert_eq!(
        judge_user_prompt("[agent] on it\n", "see this"),
        "The thread so far:\n[agent] on it\n\nThe message to judge:\nsee this"
    );
}
