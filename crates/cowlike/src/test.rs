use bot_id::{BotIdStr, cowlike::CowLike};
use either::Either;
use macro_user_id::user_id::MacroUserIdStr;

#[test]
fn either_left_bot_id_str_into_owned_and_copied_preserve_contents() {
    let storage = "bot|00000000-0000-0000-0000-00000000a1a1";

    let copied_value: Either<BotIdStr<'_>, MacroUserIdStr<'_>> =
        Either::Left(BotIdStr::parse_from_str(storage).unwrap());
    let copied = copied_value.copied();
    assert!(matches!(copied, Either::Left(bot_id) if bot_id.as_ref() == storage));

    let owned_value: Either<BotIdStr<'_>, MacroUserIdStr<'_>> =
        Either::Left(BotIdStr::parse_from_str(storage).unwrap());
    let owned = owned_value.into_owned();
    assert!(matches!(owned, Either::Left(bot_id) if bot_id.as_ref() == storage));
}

#[test]
fn either_right_macro_user_id_str_into_owned_and_copied_preserve_contents() {
    let storage = "macro|alice@example.com";

    let copied_value: Either<BotIdStr<'_>, MacroUserIdStr<'_>> =
        Either::Right(MacroUserIdStr::parse_from_str(storage).unwrap());
    let copied = copied_value.copied();
    assert!(matches!(copied, Either::Right(user_id) if user_id.as_ref() == storage));

    let owned_value: Either<BotIdStr<'_>, MacroUserIdStr<'_>> =
        Either::Right(MacroUserIdStr::parse_from_str(storage).unwrap());
    let owned = owned_value.into_owned();
    assert!(matches!(owned, Either::Right(user_id) if user_id.as_ref() == storage));
}
