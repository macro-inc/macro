use opensearch_query_builder::*;

pub fn main() {
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let query = "testing";
    let mut bool_query = BoolQueryBuilder::new();

    bool_query
        .should(QueryType::term("content", query))
        .minimum_should_match(1);

    let mut search_request = SearchRequestBuilder::new();

    search_request.query(bool_query.build().into());

    search_request.from(from).size(page_size);

    search_request.add_sort(SortType::Field(FieldSort::new(
        "updated_at",
        SortOrder::Desc,
    )));

    search_request.highlight(
        Highlight::new().field(
            "content",
            HighlightField::new()
                .highlight_type("unified")
                .number_of_fragments(500)
                .pre_tags(["<macro_em>"])
                .post_tags(["</macro_em>"]),
        ),
    );

    let result = search_request.build();

    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                {
                    "term": {
                        "content": query
                    }
                },
                ],
                "minimum_should_match": 1
            }
        },
        "from": from,
        "size": page_size,
        "sort":  [
            {
                "updated_at": "desc",
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified", // The way the highlight is done
                    "number_of_fragments": 500, // Breaks up the "content" field into said
                    "pre_tags": ["<macro_em>"], // HTML tag before highlight
                    "post_tags": ["</macro_em>"], // HTML tag after highlight
                }
            }
        },
    });

    assert_eq!(result.to_json(), reference);
}
