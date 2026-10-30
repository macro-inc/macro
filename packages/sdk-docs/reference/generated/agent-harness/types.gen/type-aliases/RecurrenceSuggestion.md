# Type Alias: RecurrenceSuggestion

> **RecurrenceSuggestion** = \{ `by_day`: [`WeekdayCode`](WeekdayCode.md)[]; `ends`: [`RecurrenceEnd`](RecurrenceEnd.md); `frequency`: [`RecurrenceFrequency`](RecurrenceFrequency.md); `interval`: `number`; `monthly_by_day?`: `null` \| [`MonthlyWeekday`](MonthlyWeekday.md); \}

Resolved, editable repetition values; the existing calendar serializer builds RRULEs.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-by_day"></a> `by_day` | [`WeekdayCode`](WeekdayCode.md)[] | Weekly weekday selectors. |
| <a id="property-ends"></a> `ends` | [`RecurrenceEnd`](RecurrenceEnd.md) | Resolved ending condition. |
| <a id="property-frequency"></a> `frequency` | [`RecurrenceFrequency`](RecurrenceFrequency.md) | Repetition unit. |
| <a id="property-interval"></a> `interval` | `number` | Positive interval. |
| <a id="property-monthly_by_day"></a> `monthly_by_day?` | `null` \| [`MonthlyWeekday`](MonthlyWeekday.md) | - |
