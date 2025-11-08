pub const CONFIDENCE_SCORING_PROMPT: &str = r#"For each insight, assign a confidence score from 1 to 5 that reflects not only how strongly supported the insight is by the underlying data (i.e., how confident we are it's true), but also how useful or actionable it would be to the end user.
This score should blend the concepts of evidence strength and user value.
Use the following scale:
	•	1 (Very Low Usefulness): The insight is highly speculative or based on minimal evidence. It is unlikely to be useful or meaningful to the user.
	•	2 (Low Usefulness): There is some indication supporting the insight, but it is uncertain or only weakly useful. The relevance to the user may be limited or unclear.
	•	3 (Moderate Usefulness): The insight has reasonable support and is somewhat useful to the user. It reflects a moderate pattern or behavior that could be informative but may not be highly impactful.
	•	4 (High Usefulness): The insight is well-supported by strong evidence and has clear potential value to the user. It likely reflects a real, recurring behavior or preference and could support better personalization or decision-making.
	•	5 (Very High Usefulness): The insight is supported by consistent and compelling evidence and would be highly valuable or actionable for the user. It reveals a meaningful pattern that could directly improve their experience or outcomes.
Ensure each score reflects this combined notion of trustworthiness and user value, not just raw data confidence."#;

pub const CLASSIFICATION_TYPES_PROMPT: &str = r#"Additionally, classify each insight into one of these types:
- "actionable": Requires user action or decision-making (e.g., preferences that suggest specific actions)
- "informational": Background information about user preferences or characteristics (e.g., demographic info, general preferences)
- "warning": Potential issues, risks, or problems to be aware of (e.g., concerning patterns, security issues)
- "trend": Pattern or trend analysis over time (e.g., changing behaviors, usage patterns)"#;

pub const KEYWORDS_PROMPT: &str = r#"Also provide 3-5 relevant keywords that describe the main topics, themes, or concepts of the insight. These should be single words or short phrases that capture the essence of the insight for search and categorization purposes."#;
