use super::*;

fn levels_of(text: &str, base: u8) -> Vec<u8> {
    let classes: Vec<Class> = text.chars().map(class).collect();
    levels(&classes, &vec![false; classes.len()], base)
}

/// The text in visual order (left to right), one cluster per character
/// of width 1.
fn visual(text: &str, base: u8) -> String {
    let chars: Vec<char> = text.chars().collect();
    let lv = levels_of(text, base);
    let mut x: Vec<f32> = (0..chars.len()).map(|i| i as f32).collect();
    let adv = vec![1.0; chars.len()];
    reorder(&mut x, &adv, &lv, base, (0.0, chars.len() as f32));
    let mut order: Vec<usize> = (0..chars.len()).collect();
    order.sort_by(|&a, &b| x[a].total_cmp(&x[b]));
    order
        .iter()
        .map(|&i| {
            let c = chars[i];
            if lv[i] % 2 == 1 {
                mirror(c).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

#[test]
fn classes_of_common_characters() {
    assert_eq!(class('a'), Class::L);
    assert_eq!(class('\u{05D0}'), Class::R);
    assert_eq!(class('\u{0628}'), Class::Al);
    assert_eq!(class('\u{0661}'), Class::An);
    assert_eq!(class('7'), Class::En);
    assert_eq!(class(','), Class::Cs);
    assert_eq!(class('%'), Class::Et);
    assert_eq!(class(' '), Class::Ws);
    assert_eq!(class('\t'), Class::S);
    assert_eq!(class('('), Class::On);
    assert_eq!(class('\u{064E}'), Class::Nsm);
}

#[test]
fn hebrew_reads_right_to_left_with_numbers_left_to_right() {
    // Letters stand for Hebrew: A = alef, B = bet, ...
    let he = |s: &str| {
        s.chars()
            .map(|c| match c {
                'A'..='Z' => char::from_u32(0x05D0 + (c as u32 - 'A' as u32)).unwrap(),
                c => c,
            })
            .collect::<String>()
    };
    // Right-to-left paragraph: words in reverse order, 123 stays.
    assert_eq!(visual(&he("AB 123 CD"), 1), he("DC 123 BA"));
    // English inside a right-to-left paragraph keeps its order.
    assert_eq!(visual(&he("AB word CD"), 1), he("DC word BA"));
    // Hebrew inside an English paragraph.
    assert_eq!(visual(&he("go AB now"), 0), he("go BA now"));
    // Brackets mirror in right-to-left text.
    assert_eq!(visual(&he("A (B) C"), 1), he("C (B) A"));
}

#[test]
fn european_numbers_after_arabic_letters_are_arabic_numbers() {
    let lv = levels_of("\u{0628} 12", 0);
    // The digits are numbers at level 2 inside the right-to-left run.
    assert_eq!(lv, vec![1, 1, 2, 2]);
    // After a Latin letter they are left to right, with the space between.
    let lv = levels_of("a 12", 1);
    assert_eq!(lv, vec![2, 2, 2, 2]);
}

#[test]
fn tabs_and_trailing_spaces_take_the_paragraph_level() {
    let lv = levels_of("\u{05D0}\u{05D1} \tx ", 0);
    assert_eq!(lv, vec![1, 1, 0, 0, 0, 0]);
}

#[test]
fn right_to_left_lines_start_at_the_area_right() {
    // Two clusters of width 2 in an area 10 wide, in a right-to-left
    // paragraph: the first sits at the right edge.
    let mut x = vec![0.0, 2.0];
    reorder(&mut x, &[2.0, 2.0], &[1, 1], 1, (0.0, 10.0));
    assert_eq!(x, vec![8.0, 6.0]);
}

#[test]
fn neutrals_in_right_to_left_runs_read_right_to_left() {
    // "a b" in a left-to-right paragraph: the space is between two
    // left-to-right letters either way.
    let classes: Vec<Class> = "a (\u{05D0}".chars().map(class).collect();
    let plain = levels(&classes, &[false; 4], 0);
    let rtl = levels(&classes, &[false, true, true, true], 0);
    assert_eq!(plain, vec![0, 0, 0, 1]);
    assert_eq!(rtl, vec![0, 1, 1, 1]);
}

#[test]
fn separators_in_right_to_left_runs_split_numbers() {
    let classes: Vec<Class> = "78/265".chars().map(class).collect();
    // In a left-to-right run: one number.
    assert_eq!(levels(&classes, &[false; 6], 1), vec![2; 6]);
    // In a right-to-left run (as Word shows dates and references there):
    // two numbers read right to left, the slash between them.
    assert_eq!(levels(&classes, &[true; 6], 1), vec![2, 2, 1, 2, 2, 2]);
}
