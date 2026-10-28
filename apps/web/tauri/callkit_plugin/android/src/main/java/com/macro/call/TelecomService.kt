package com.macro.call

import android.net.Uri
import android.telecom.*
import android.os.Build
import android.os.OutcomeReceiver

class TelecomService : ConnectionService() {
    override fun onConnectionServiceFocusLost() {
        Calls.telecomFocus(false)
        connectionServiceFocusReleased()
    }
    override fun onConnectionServiceFocusGained() { Calls.telecomFocus(true) }
    override fun onCreateIncomingConnection(handle: PhoneAccountHandle, request: ConnectionRequest): Connection = create(request, true)
    override fun onCreateOutgoingConnection(handle: PhoneAccountHandle, request: ConnectionRequest): Connection = create(request, false)
    private fun create(request: ConnectionRequest, incoming: Boolean): Connection {
        val id = request.extras?.getString("callId")
        val offer = Calls.offer
        if (offer == null || offer.callId != id) return Connection.createFailedConnection(DisconnectCause(DisconnectCause.CANCELED))
        return MacroConnection(id).apply {
            connectionProperties = Connection.PROPERTY_SELF_MANAGED
            connectionCapabilities = Connection.CAPABILITY_SUPPORT_HOLD or Connection.CAPABILITY_HOLD or Connection.CAPABILITY_MUTE
            setAddress(Uri.parse("macro-call:$id"), TelecomManager.PRESENTATION_ALLOWED)
            setCallerDisplayName(offer.title, TelecomManager.PRESENTATION_ALLOWED)
            setAudioModeIsVoip(true)
            Calls.connection = this
            // App Join can adopt an incoming offer before Telecom creates it.
            if (incoming && Calls.snapshot() == null) setRinging()
            else {
                if (Calls.state == "connected") setActive() else setDialing()
                if (!incoming) Calls.connect(applicationContext)
            }
        }
    }
    override fun onCreateIncomingConnectionFailed(handle: PhoneAccountHandle, request: ConnectionRequest) { Calls.end(applicationContext, request.extras?.getString("callId")) }
    override fun onCreateOutgoingConnectionFailed(handle: PhoneAccountHandle, request: ConnectionRequest) { Calls.end(applicationContext, request.extras?.getString("callId")) }

    inner class MacroConnection(private val id: String) : Connection() {
        private var endpoints: List<CallEndpoint> = emptyList()
        override fun onShowIncomingCallUi() { if (Calls.offer?.callId == id) Calls.showIncoming(applicationContext) }
        override fun onAnswer() { Calls.answer(applicationContext, id) }
        override fun onAnswer(videoState: Int) { onAnswer() }
        override fun onReject() { Calls.end(applicationContext, id) }
        override fun onDisconnect() { Calls.end(applicationContext, id) }
        override fun onHold() { if (Calls.offer?.callId == id) { Calls.hold(true); setOnHold() } }
        override fun onUnhold() { if (Calls.offer?.callId == id) { Calls.hold(false); setActive() } }
        override fun onCallAudioStateChanged(state: CallAudioState) { if (Calls.offer?.callId == id) Calls.telecomAudio(state) }
        override fun onAvailableCallEndpointsChanged(available: MutableList<CallEndpoint>) { endpoints = available.toList() }
        override fun onCallEndpointChanged(endpoint: CallEndpoint) { if (Calls.offer?.callId == id) Calls.endpointAudio(endpoint.endpointType) }
        override fun onMuteStateChanged(isMuted: Boolean) { if (Calls.offer?.callId == id) Calls.systemMute(isMuted) }
        fun route(route: Int) {
            if (Build.VERSION.SDK_INT >= 34) {
                val type = when (route) {
                    CallAudioState.ROUTE_BLUETOOTH -> CallEndpoint.TYPE_BLUETOOTH
                    CallAudioState.ROUTE_WIRED_HEADSET -> CallEndpoint.TYPE_WIRED_HEADSET
                    CallAudioState.ROUTE_SPEAKER -> CallEndpoint.TYPE_SPEAKER
                    else -> CallEndpoint.TYPE_EARPIECE
                }
                val endpoint = endpoints.firstOrNull { it.endpointType == type } ?: return
                requestCallEndpointChange(endpoint, mainExecutor, object : OutcomeReceiver<Void, CallEndpointException> {
                    override fun onResult(result: Void?) { Calls.endpointAudio(type) }
                    override fun onError(error: CallEndpointException) { Calls.publish() }
                })
            } else setAudioRoute(route)
        }
    }
}
