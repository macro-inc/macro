/** The people area's settings: where its records are, and which model reads an exchange. */

/** The owner of the people area's state directories. Its records are private: never committed. */
export const owner = "people";

/** The log stream: every proposal's fate, and who each run was shown, never what. */
export const logStream = "people";

/** The model that appraises an exchange and writes reflections: a cheap one, not the agent's own. */
export const appraiseModel = "claude-sonnet-5-5";

/** How long one appraisal or reflection may take. */
export const askTimeoutMs = 120_000;

/** Lines of a conversation's history the appraiser reads as context, so the agent's reply is there. */
export const contextLines = 12;
