package com.macro.call

import org.json.JSONObject
import java.net.URI
import java.util.UUID

/** Credentials stay in memory; only resolved call ids are persisted. */
internal data class CallOffer(
    val callId: String,
    val channelId: String,
    val title: String,
    val serverUrl: String,
    val token: String,
    val ringUrl: String? = null,
    val sentTime: Long = System.currentTimeMillis(),
) {
    companion object {
        fun fresh(sentTime: Long, now: Long): Boolean = RingPolicy.fresh(sentTime, now)
        fun parse(json: String, sentTime: Long): CallOffer {
            val data = JSONObject(json)
            val id = UUID.fromString(data.getString("callId")).toString()
            val server = data.getString("livekitServerUrl")
            require(URI(server).let { it.scheme == "wss" && it.host != null && it.userInfo == null })
            val ring = data.getString("ringStatusUrl")
            require(URI(ring).let { it.scheme == "https" && (it.host == "macro.com" || it.host?.endsWith(".macro.com") == true) && it.userInfo == null })
            return CallOffer(id, data.getString("channelId"), data.optString("channelName", "Macro call"), server,
                data.getString("livekitToken"), ring, sentTime).also {
                require(it.channelId.isNotBlank() && it.token.isNotBlank())
            }
        }
    }
}
