package com.macro.push

/** The backend data-only FCM contract. Reject unknown or unowned messages. */
internal data class PushMessage(
    val identifier: String,
    val recipientId: String,
    val clear: Boolean,
    val title: String,
    val body: String,
    val payload: String,
) {
    companion object {
        fun parse(data: Map<String, String>, activeRecipient: String?): PushMessage? {
            val recipient = data["recipientId"] ?: return null
            if (activeRecipient.isNullOrEmpty() || recipient != activeRecipient) return null
            val identifier = data["identifier"]?.takeIf { it.isNotBlank() } ?: return null
            val type = data["type"]
            if (type != "notification" && type != "clear") return null
            if (type == "notification" && data["title"].isNullOrBlank() && data["body"].isNullOrBlank()) return null
            return PushMessage(identifier, recipient, type == "clear", data["title"].orEmpty(),
                data["body"].orEmpty(), data["payload"] ?: "{}")
        }
    }
}
