//! Recipe collection: a small cookbook organized by meal.

use super::{
    DatabaseTemplate, SELECT, TemplateContext, TemplateIcon, TemplateId, board, create_column,
    create_table, insert_rows, number, option, options, table_view, text,
};
use models_databases::views::{FilterCondition, FilterTest, NumberOperator};
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::RecipeCollection,
    name: "Recipe collection",
    description: "Keep favorite dishes, ingredients and cooking notes in your own little cookbook.",
    icon: TemplateIcon::ForkKnife,
};

pub(super) fn ops(_: &TemplateContext) -> Vec<DatabaseOp> {
    let recipes = TableId::new();
    let name = ColumnId::new();
    let meal = ColumnId::new();
    let minutes = ColumnId::new();
    let servings = ColumnId::new();
    let ingredients = ColumnId::new();
    let instructions = ColumnId::new();
    let meals = options(&["Breakfast", "Lunch", "Dinner", "Snack"]);
    let [breakfast, lunch, dinner, snack] = [&meals[0], &meals[1], &meals[2], &meals[3]];
    vec![
        create_table(recipes, "Recipes"),
        create_column(recipes, name, "Recipe", ColumnKind::Text, &[]),
        create_column(recipes, meal, "Meal", SELECT, &meals),
        create_column(recipes, minutes, "Prep minutes", ColumnKind::Number, &[]),
        create_column(recipes, servings, "Servings", ColumnKind::Number, &[]),
        create_column(recipes, ingredients, "Ingredients", ColumnKind::Text, &[]),
        create_column(recipes, instructions, "Instructions", ColumnKind::Text, &[]),
        table_view(
            recipes,
            "Quick recipes",
            Some(FilterCondition {
                column: minutes,
                test: FilterTest::Number {
                    operator: NumberOperator::LessThanOrEqual,
                    value: 20.0,
                },
            }),
            &[minutes, name],
        ),
        board(
            recipes,
            "By meal",
            (meal, &meals),
            name,
            &[minutes, servings],
        ),
        insert_rows(
            recipes,
            vec![
                vec![
                    text(name, "Lemon pasta"),
                    option(meal, dinner),
                    number(minutes, 20.0),
                    number(servings, 2.0),
                    text(ingredients, "Pasta, lemon, olive oil, parmesan"),
                    text(
                        instructions,
                        "Cook pasta, then toss with lemon zest, olive oil, parmesan and a splash of pasta water.",
                    ),
                ],
                vec![
                    text(name, "Overnight oats"),
                    option(meal, breakfast),
                    number(minutes, 5.0),
                    number(servings, 1.0),
                    text(ingredients, "Oats, milk, yogurt, berries"),
                    text(
                        instructions,
                        "Mix oats, milk and yogurt in a jar. Refrigerate overnight and top with berries.",
                    ),
                ],
                vec![
                    text(name, "Roasted vegetable bowl"),
                    option(meal, lunch),
                    number(minutes, 30.0),
                    number(servings, 2.0),
                    text(ingredients, "Seasonal vegetables, rice, chickpeas, tahini"),
                    text(
                        instructions,
                        "Roast chopped vegetables until tender. Serve over rice with chickpeas and tahini.",
                    ),
                ],
                vec![
                    text(name, "Chocolate energy bites"),
                    option(meal, snack),
                    number(minutes, 15.0),
                    number(servings, 6.0),
                    text(ingredients, "Oats, nut butter, honey, cocoa"),
                    text(
                        instructions,
                        "Mix ingredients, roll into small balls and chill until firm.",
                    ),
                ],
            ],
        ),
    ]
}
