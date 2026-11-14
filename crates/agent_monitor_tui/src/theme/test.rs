use strum::IntoEnumIterator as _;

use super::*;

#[test]
fn theme_names_round_trip_through_config_spelling() {
    for name in ThemeName::iter() {
        assert_eq!(name.to_string().parse::<ThemeName>(), Ok(name));
        assert_eq!(name.theme().name, name);
    }
    assert!("neon".parse::<ThemeName>().is_err());
}

#[test]
fn every_theme_keeps_the_amber_ink_and_orange_chips() {
    for name in ThemeName::iter() {
        let theme = name.theme();
        assert_eq!(theme.text, CLASSIC.text, "{name}");
        assert_eq!(theme.accent, CLASSIC.accent, "{name}");
        assert_eq!(theme.bg, CLASSIC.bg, "{name}");
    }
}

#[test]
fn signal_roles_stay_apart_in_every_theme() {
    for name in ThemeName::iter() {
        let theme = name.theme();
        let alert = theme.color(Token::Alert);
        for other in [Token::Ok, Token::Info, Token::Highlight, Token::Accent] {
            assert_ne!(alert, theme.color(other), "{name}: alert vs {other:?}");
        }
        assert_ne!(theme.color(Token::Ok), theme.color(Token::Info), "{name}");
    }
}

#[test]
fn the_active_theme_is_per_thread() {
    set_active(ThemeName::Dusk);
    assert_eq!(Token::Info.color(), DUSK.info);
    std::thread::spawn(|| assert_eq!(Token::Info.color(), CLASSIC.info))
        .join()
        .expect("the other thread draws in classic");
    set_active(ThemeName::Classic);
}

#[cfg(feature = "mesh-man")]
#[test]
fn classic_draws_the_figure_in_its_original_colours() {
    assert_eq!(CLASSIC.figure, mesh_man::Palette::DEFAULT);
}
