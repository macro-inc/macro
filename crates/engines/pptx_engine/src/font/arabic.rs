//! Arabic joining through the Unicode presentation forms.
//!
//! An Arabic letter takes one of four shapes depending on whether it joins
//! the letters around it. Rather than running a face's GSUB lookups (the
//! bundled Noto faces build letters from separate dots positioned by GPOS),
//! shaping picks the precomposed presentation form of each letter (the
//! Arabic Presentation Forms-A and -B blocks, which those faces and most
//! Arabic fonts map), and joins lam with a following alef into one of the
//! lam-alef ligatures.

/// How a character joins its neighbours (Unicode `Joining_Type`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Joining {
    /// Joins on both sides (beh, seen, lam...).
    Dual,
    /// Joins only the preceding letter (alef, dal, reh, waw...).
    Right,
    /// Joins on both sides without changing shape (tatweel, ZWJ).
    Causing,
    /// Does not take part: joining continues across it (vowel marks).
    Transparent,
    /// Breaks joining.
    None,
}

/// A letter's shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum JoinForm {
    /// Joined on neither side.
    Isolated,
    /// Joined to the following letter only.
    Initial,
    /// Joined on both sides.
    Medial,
    /// Joined to the preceding letter only.
    Final,
}

/// The joining type of a character.
pub fn joining(c: char) -> Joining {
    let u = c as u32;
    match u {
        0x064B..=0x065F
        | 0x0670
        | 0x0610..=0x061A
        | 0x06D6..=0x06DC
        | 0x06DF..=0x06E4
        | 0x06E7
        | 0x06E8
        | 0x06EA..=0x06ED
        | 0x08D3..=0x08E1
        | 0x08E3..=0x08FF => Joining::Transparent,
        0x0640 | 0x200D => Joining::Causing,
        0x0622..=0x0625
        | 0x0627
        | 0x0629
        | 0x062F..=0x0632
        | 0x0648
        | 0x0671..=0x0673
        | 0x0675..=0x0677
        | 0x0688..=0x0699
        | 0x06C0
        | 0x06C3..=0x06CB
        | 0x06CD
        | 0x06CF
        | 0x06D2
        | 0x06D3
        | 0x06D5
        | 0x06EE
        | 0x06EF
        | 0x0759..=0x075B
        | 0x076B
        | 0x076C
        | 0x0771
        | 0x0773
        | 0x0774
        | 0x0778
        | 0x0779 => Joining::Right,
        0x0626
        | 0x0628
        | 0x062A..=0x062E
        | 0x0633..=0x063F
        | 0x0641..=0x0647
        | 0x0649
        | 0x064A
        | 0x066E
        | 0x066F
        | 0x0678..=0x0687
        | 0x069A..=0x06BF
        | 0x06C1
        | 0x06C2
        | 0x06CC
        | 0x06CE
        | 0x06D0
        | 0x06D1
        | 0x06FA..=0x06FC
        | 0x06FF
        | 0x0750..=0x0758
        | 0x075C..=0x076A
        | 0x076D..=0x0770
        | 0x0772
        | 0x0775..=0x0777
        | 0x077A..=0x077F => Joining::Dual,
        _ => Joining::None,
    }
}

/// Presentation forms (isolated, final, initial, medial; 0 = none).
const FORMS_B: [[u16; 4]; 42] = [
    [0xFE80, 0, 0, 0],                // 0621 hamza
    [0xFE81, 0xFE82, 0, 0],           // 0622 alef with madda
    [0xFE83, 0xFE84, 0, 0],           // 0623 alef with hamza above
    [0xFE85, 0xFE86, 0, 0],           // 0624 waw with hamza
    [0xFE87, 0xFE88, 0, 0],           // 0625 alef with hamza below
    [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C], // 0626 yeh with hamza
    [0xFE8D, 0xFE8E, 0, 0],           // 0627 alef
    [0xFE8F, 0xFE90, 0xFE91, 0xFE92], // 0628 beh
    [0xFE93, 0xFE94, 0, 0],           // 0629 teh marbuta
    [0xFE95, 0xFE96, 0xFE97, 0xFE98], // 062A teh
    [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], // 062B theh
    [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], // 062C jeem
    [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], // 062D hah
    [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], // 062E khah
    [0xFEA9, 0xFEAA, 0, 0],           // 062F dal
    [0xFEAB, 0xFEAC, 0, 0],           // 0630 thal
    [0xFEAD, 0xFEAE, 0, 0],           // 0631 reh
    [0xFEAF, 0xFEB0, 0, 0],           // 0632 zain
    [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], // 0633 seen
    [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], // 0634 sheen
    [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], // 0635 sad
    [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], // 0636 dad
    [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], // 0637 tah
    [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], // 0638 zah
    [0xFEC9, 0xFECA, 0xFECB, 0xFECC], // 0639 ain
    [0xFECD, 0xFECE, 0xFECF, 0xFED0], // 063A ghain
    [0, 0, 0, 0],                     // 063B
    [0, 0, 0, 0],                     // 063C
    [0, 0, 0, 0],                     // 063D
    [0, 0, 0, 0],                     // 063E
    [0, 0, 0, 0],                     // 063F
    [0, 0, 0, 0],                     // 0640 tatweel
    [0xFED1, 0xFED2, 0xFED3, 0xFED4], // 0641 feh
    [0xFED5, 0xFED6, 0xFED7, 0xFED8], // 0642 qaf
    [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], // 0643 kaf
    [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], // 0644 lam
    [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], // 0645 meem
    [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], // 0646 noon
    [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], // 0647 heh
    [0xFEED, 0xFEEE, 0, 0],           // 0648 waw
    [0xFEEF, 0xFEF0, 0xFBE8, 0xFBE9], // 0649 alef maksura
    [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], // 064A yeh
];

/// Presentation forms of letters outside the basic range (Persian, Urdu).
const FORMS_A: &[(u16, [u16; 4])] = &[
    (0x0671, [0xFB50, 0xFB51, 0, 0]),
    (0x0679, [0xFB66, 0xFB67, 0xFB68, 0xFB69]),
    (0x067E, [0xFB56, 0xFB57, 0xFB58, 0xFB59]),
    (0x0686, [0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D]),
    (0x0688, [0xFB88, 0xFB89, 0, 0]),
    (0x0691, [0xFB8C, 0xFB8D, 0, 0]),
    (0x0698, [0xFB8A, 0xFB8B, 0, 0]),
    (0x06A9, [0xFB8E, 0xFB8F, 0xFB90, 0xFB91]),
    (0x06AF, [0xFB92, 0xFB93, 0xFB94, 0xFB95]),
    (0x06BA, [0xFB9E, 0xFB9F, 0, 0]),
    (0x06BE, [0xFBAA, 0xFBAB, 0xFBAC, 0xFBAD]),
    (0x06C0, [0xFBA4, 0xFBA5, 0, 0]),
    (0x06C1, [0xFBA6, 0xFBA7, 0xFBA8, 0xFBA9]),
    (0x06CC, [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF]),
    (0x06D2, [0xFBAE, 0xFBAF, 0, 0]),
    (0x06D3, [0xFBB0, 0xFBB1, 0, 0]),
];

fn index(form: JoinForm) -> usize {
    match form {
        JoinForm::Isolated => 0,
        JoinForm::Final => 1,
        JoinForm::Initial => 2,
        JoinForm::Medial => 3,
    }
}

/// The presentation form of a letter in a shape, when Unicode has one.
pub fn presentation_form(c: char, form: JoinForm) -> Option<char> {
    let u = c as u32;
    let forms = if (0x0621..=0x064A).contains(&u) {
        &FORMS_B[(u - 0x0621) as usize]
    } else {
        &FORMS_A.iter().find(|(base, _)| u32::from(*base) == u)?.1
    };
    let code = forms[index(form)];
    (code != 0)
        .then(|| char::from_u32(u32::from(code)))
        .flatten()
}

/// The lam-alef ligature for lam followed by `alef`: joined to the letter
/// before the lam (final form) or not (isolated).
pub fn lam_alef(alef: char, joined_before: bool) -> Option<char> {
    let isolated = match alef {
        '\u{0622}' => 0xFEF5,
        '\u{0623}' => 0xFEF7,
        '\u{0625}' => 0xFEF9,
        '\u{0627}' => 0xFEFB,
        _ => return None,
    };
    char::from_u32(isolated + u32::from(joined_before))
}

/// The shape of each character of a run of text: `None` for characters
/// that do not change, the form of each letter otherwise. Joining looks
/// across transparent characters (vowel marks).
pub fn forms(chars: &[char]) -> Vec<Option<JoinForm>> {
    let types: Vec<Joining> = chars.iter().map(|&c| joining(c)).collect();
    forms_of(&types)
}

/// [`forms`] for characters given by their joining types.
pub fn forms_of(types: &[Joining]) -> Vec<Option<JoinForm>> {
    let neighbour = |from: usize, step: isize| -> Joining {
        let mut i = from as isize + step;
        while i >= 0 && (i as usize) < types.len() {
            match types[i as usize] {
                Joining::Transparent => i += step,
                t => return t,
            }
        }
        Joining::None
    };
    types
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let (dual, right) = match t {
                Joining::Dual => (true, true),
                Joining::Right => (false, true),
                _ => return None,
            };
            // Joined to the preceding letter when that one joins forward.
            let before = right && matches!(neighbour(i, -1), Joining::Dual | Joining::Causing);
            // Joined to the following letter when it joins backward.
            let after = dual
                && matches!(
                    neighbour(i, 1),
                    Joining::Dual | Joining::Right | Joining::Causing
                );
            Some(match (before, after) {
                (true, true) => JoinForm::Medial,
                (true, false) => JoinForm::Final,
                (false, true) => JoinForm::Initial,
                (false, false) => JoinForm::Isolated,
            })
        })
        .collect()
}

#[cfg(test)]
mod test;
