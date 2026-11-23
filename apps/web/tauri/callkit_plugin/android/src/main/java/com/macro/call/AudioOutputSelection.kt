package com.macro.call

/** Reject commands targeting a previous call, even if a new session is already connected. */
internal object AudioOutputSelection {
    fun allowed(activeCallId: String?, requestedCallId: String, connected: Boolean): Boolean =
        connected && activeCallId == requestedCallId
}
