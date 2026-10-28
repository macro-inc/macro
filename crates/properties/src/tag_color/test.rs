use super::TagColor;

#[test]
fn new_options_cycle_the_palette_in_hue_order() {
    let colors: Vec<&str> = (0..13)
        .map(|position| TagColor::for_position(position).hex())
        .collect();
    assert_eq!(
        colors,
        [
            "#0091FF", "#46A758", "#8E4EC6", "#F76B15", "#E93D82", "#12A594", "#FFB224", "#3E63DD",
            "#E5484D", "#F5D90A", "#889096", "#E54D2E", "#0091FF",
        ]
    );
}
