package com.macro.call

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import io.livekit.android.LiveKit
import io.livekit.android.room.track.VideoTrack
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Optional integration test against LiveKit's isolated --dev server. */
@RunWith(AndroidJUnit4::class)
class MediaLifecycleTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test fun nativeRoomSurvivesDuplicateStartAndReleasesCapture() {
        val url = InstrumentationRegistry.getArguments().getString("livekitUrl")
        assumeNotNull(url)
        for (permission in listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)) {
            instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} $permission").close()
            instrumentation.awaitCondition("Capture permission was not granted") { context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED }
        }
        val offer = CallOffer(UUID.randomUUID().toString(), "media-test", "Emulator media", url!!, liveKitToken("android-emulator-test", "android-call-test"))
        val previousTheme = Calls.drawerTheme
        val lightTheme = CallTheme(android.graphics.Color.WHITE, android.graphics.Color.rgb(30,30,30), android.graphics.Color.rgb(245,245,245),
            0x66000000, android.graphics.Color.rgb(230,230,230), android.graphics.Color.rgb(205,205,205), android.graphics.Color.DKGRAY,
            android.graphics.Color.rgb(225,55,55), android.graphics.Color.rgb(20,145,95))
        val darkTheme = lightTheme.copy(drawer = android.graphics.Color.rgb(20,20,20), text = android.graphics.Color.WHITE,
            tile = android.graphics.Color.rgb(30,30,30), edgeMuted = android.graphics.Color.rgb(48,48,48), edge = android.graphics.Color.rgb(80,80,80), muted = android.graphics.Color.LTGRAY)
        Calls.drawerTheme = lightTheme
        val observer = LiveKit.create(context)
        val extraObservers = List(3) { LiveKit.create(context) }
        val agent = LiveKit.create(context)
        val monitor = instrumentation.addMonitor(CallActivity::class.java.name, null, false)
        try {
            instrumentation.runOnMainSync {
                Calls.outgoing(context, offer)
                context.startActivity(Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            val activity = instrumentation.waitForMonitorWithTimeout(monitor, 5000)
            assertNotNull("Native call controls did not open", activity)
            instrumentation.awaitCondition("Native room did not connect") { Calls.state == "connected" }
            instrumentation.runOnMainSync { Calls.scope.launch { observer.connect(url, liveKitToken("media-observer", "android-call-test")) } }
            instrumentation.awaitCondition("Remote participant did not join") { Calls.room?.remoteParticipants?.isNotEmpty() == true }
            instrumentation.runOnMainSync {
                extraObservers.forEachIndexed { index, extra -> Calls.scope.launch { extra.connect(url, liveKitToken("tile-observer-$index", "android-call-test")) } }
                Calls.scope.launch { agent.connect(url, liveKitToken("agent-transcriber", "android-call-test", kind = "agent")) }
            }
            instrumentation.awaitCondition("Participant strip test peers did not join") { Calls.room?.remoteParticipants?.size == 5 }
            val root = activity!!.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as android.widget.FrameLayout
            fun assertDrawer(expectedTheme: CallTheme) {
                val drawer = root.findViewWithTag<android.widget.LinearLayout>("call-drawer")
                assertNotNull(drawer)
                val safeHeight = root.height - root.paddingTop - root.paddingBottom
                assertEquals("Drawer must use 92% of the safe screen", (safeHeight * 0.92f).toInt(), drawer.height)
                assertEquals(expectedTheme.drawer, (drawer.background as android.graphics.drawable.GradientDrawable).color!!.defaultColor)
                val controls = root.findViewWithTag<android.view.View>("call-controls")
                val position = IntArray(2); controls.getLocationOnScreen(position)
                val rootPosition = IntArray(2); root.getLocationOnScreen(rootPosition)
                assertTrue("Controls must stay above Android navigation insets",
                    position[1] + controls.height <= rootPosition[1] + root.height - root.paddingBottom)
                assertEquals(3, (controls as android.view.ViewGroup).childCount)
                val agentViews = arrayListOf<android.view.View>()
                root.findViewsWithText(agentViews, "agent-transcriber", android.view.View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION)
                assertTrue("Agents such as the transcriber must not appear as call participants", agentViews.isEmpty())
                assertFalse(Calls.snapshot()!!.getJSONArray("participantIdentities").toString().contains("agent-transcriber"))
                assertTrue(root.findViewWithTag<android.view.View>("call-primary").height > root.findViewWithTag<android.view.View>("call-participant-strip").height)
            }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                assertDrawer(lightTheme)
                val strip = root.findViewWithTag<android.widget.HorizontalScrollView>("call-participant-strip")
                assertTrue("Participant chips must scroll horizontally", strip.canScrollHorizontally(1))
                strip.scrollTo(100, 0)
                assertTrue(strip.scrollX > 0)
            }
            instrumentation.screenshot("call-drawer-light.png")
            instrumentation.runOnMainSync { Calls.drawerTheme = darkTheme; Calls.publish() }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync { assertDrawer(darkTheme) }
            instrumentation.screenshot("call-drawer-dark.png")
            instrumentation.awaitCondition("Audio foreground service did not start") { CallService.instance != null }
            instrumentation.runOnMainSync {
                Calls.showIncoming(context)
                assertTrue("Late Telecom notification must retain microphone support",
                    CallService.instance!!.foregroundServiceType and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE != 0)
            }
            instrumentation.runOnMainSync {
                val room = Calls.room
                var injected = false
                CallService.instance!!.handleStart(Intent().putExtra("media", true).putExtra("camera", true)) { _, types ->
                    assertTrue(types and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA != 0)
                    injected = true
                    throw SecurityException("Simulated camera promotion denial")
                }
                assertTrue("Failure must occur at the foreground promotion boundary", injected)
                assertSame("Camera promotion failure must retain the audio room", room, Calls.room)
                assertEquals("connected", Calls.state)
                assertEquals(offer.callId, Calls.offer?.callId)
                assertNotNull(CallService.instance)
            }
            instrumentation.awaitCondition("Failed camera promotion must preserve the ongoing notification") {
                context.getSystemService(android.app.NotificationManager::class.java)
                    .activeNotifications.any { it.id == CallService.NOTIFICATION_ID }
            }
            instrumentation.runOnMainSync {
                val room = Calls.room
                assertNotNull(room)
                Calls.outgoing(context, offer)
                assertSame("Duplicate start must retain the media room", room, Calls.room)
                root.findViewWithTag<android.view.View>("call-control-mic").performClick()
            }
            instrumentation.awaitCondition("Native microphone did not mute") { Calls.muted }
            instrumentation.runOnMainSync { root.findViewWithTag<android.view.View>("call-control-video").performClick() }
            instrumentation.awaitCondition("Native camera did not start") { Calls.video }
            instrumentation.runOnMainSync {
                val room = Calls.room
                Calls.showIncoming(context)
                val types = CallService.instance!!.foregroundServiceType
                assertTrue("Late Telecom notification must retain microphone support",
                    types and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE != 0)
                assertTrue("Late Telecom notification must retain camera support",
                    types and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA != 0)
                assertSame(room, Calls.room)
                assertTrue(Calls.video)
            }
            instrumentation.awaitCondition("Remote participant did not receive video") {
                observer.remoteParticipants.values.any { participant -> participant.trackPublications.values.any { it.track is VideoTrack } }
            }
            instrumentation.runOnMainSync {
                val strip = root.findViewWithTag<android.widget.HorizontalScrollView>("call-participant-strip")
                val chips = strip.getChildAt(0) as android.view.ViewGroup
                val localTile = (0 until chips.childCount).map { chips.getChildAt(it) }.single { it.contentDescription == "You" }
                localTile.performClick()
                assertEquals("Selecting a chip must replace the primary participant", "You", root.findViewWithTag<android.view.View>("call-primary").contentDescription)
                assertNotNull(root.findViewWithTag<android.view.View>("call-control-switch"))
            }
            instrumentation.screenshot("call-drawer-video.png")
            instrumentation.runOnMainSync { root.findViewWithTag<android.view.View>("call-control-video").performClick() }
            instrumentation.awaitCondition("Native camera did not stop") { !Calls.video }
            instrumentation.uiAutomation.executeShellCommand("svc wifi disable").close()
            instrumentation.uiAutomation.executeShellCommand("svc data disable").close()
            try {
                instrumentation.awaitCondition("Native room did not report network interruption") { Calls.state == "reconnecting" }
            } finally {
                instrumentation.uiAutomation.executeShellCommand("svc wifi enable").close()
                instrumentation.uiAutomation.executeShellCommand("svc data enable").close()
            }
            instrumentation.awaitCondition("Native room did not reconnect") { Calls.state == "connected" }
            instrumentation.runOnMainSync { Calls.scope.launch { Calls.camera(context, true) } }
            instrumentation.awaitCondition("Native camera did not restart before PiP") { Calls.video }
            val expandedWidth = root.width
            // Leaving the app from the drawer continues the call in PiP.
            instrumentation.uiAutomation.executeShellCommand("input keyevent 3").close()
            instrumentation.awaitCondition("Call controls did not enter picture in picture") { activity!!.isInPictureInPictureMode }
            instrumentation.awaitCondition("PiP transition did not resize the activity") { root.width < expandedWidth }
            // Mode callbacks precede completion of Android's pinned-task animation.
            Thread.sleep(1_000)
            instrumentation.screenshot("call-pip.png")
            instrumentation.runOnMainSync {
                assertTrue("Entering PiP must retain camera capture", Calls.video)
                assertEquals("connected", Calls.state)
                assertNotNull("Navigation must retain the media room", Calls.room)
                context.startActivity(Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            instrumentation.awaitCondition("Reopening call controls did not expand the drawer") { !activity.isInPictureInPictureMode }
            instrumentation.awaitCondition("Expanded drawer did not regain focus") { activity.hasWindowFocus() }
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.awaitCondition("Leaving the visible call surface must stop the camera") { !Calls.video }
            instrumentation.runOnMainSync {
                assertEquals("Background audio must remain connected", "connected", Calls.state)
                Calls.end(context, offer.callId)
                assertNull(Calls.room)
                assertNull(Calls.connection)
                assertNull(Calls.snapshot())
            }
        } finally {
            instrumentation.uiAutomation.executeShellCommand("svc wifi enable").close()
            instrumentation.uiAutomation.executeShellCommand("svc data enable").close()
            instrumentation.removeMonitor(monitor)
            instrumentation.runOnMainSync {
                extraObservers.forEach { it.disconnect(); it.release() }
                agent.disconnect(); agent.release()
                observer.disconnect(); observer.release(); Calls.end(context, offer.callId)
                Calls.drawerTheme = previousTheme
            }
        }
    }
}
