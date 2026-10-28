package com.macro.auth

/** In-memory only: a browser redirect must never resurrect a process-dead invocation. */
internal object AuthSession {
    data class Pending(
        val authUrl: String,
        val callbackUrl: String,
        val taskId: Int,
        val receivedCallback: String? = null,
    )

    @Volatile
    var pending: Pending? = null
        private set

    @Synchronized
    fun begin(session: Pending): Boolean {
        if (pending != null) return false
        pending = session
        return true
    }

    fun matching(callback: String): Pending? =
        pending?.takeIf { AuthCallback.matches(it.callbackUrl, callback) }

    @Synchronized
    fun receive(callback: String): Pending? {
        val session = matching(callback) ?: return null
        if (session.receivedCallback != null) return null
        return session.copy(receivedCallback = callback).also { pending = it }
    }

    @Synchronized
    fun clear(callbackUrl: String) {
        if (pending?.callbackUrl == callbackUrl) pending = null
    }
}
