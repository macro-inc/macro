package com.macro.call

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.view.MotionEvent
import android.view.View
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import io.livekit.android.LiveKit
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Optional integration test of the iOS-style in-app call window against LiveKit's isolated --dev server. */
@RunWith(AndroidJUnit4::class)
class MiniWindowTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val room = "android-mini-window-test"

    @Test fun drawerMinimizesInAppAndLeavingTheAppContinuesInPictureInPicture() {
        val url = InstrumentationRegistry.getArguments().getString("livekitUrl")
        assumeNotNull(url)
        assumeTrue("Auto-entering PiP requires Android 12", Build.VERSION.SDK_INT >= 31)
        for (permission in listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)) {
            instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} $permission").close()
            instrumentation.awaitCondition("Capture permission was not granted") { context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED }
        }
        val offer = CallOffer(UUID.randomUUID().toString(), "mini-window-test", "Mini window", url!!, liveKitToken("mini-window-test", room))
        val observer = LiveKit.create(context)
        val host = instrumentation.startActivitySync(Intent(context, MiniWindowHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val hostRoot = host.findViewById<android.view.ViewGroup>(android.R.id.content)
        fun thumbnail() = hostRoot.findViewWithTag<View>("call-mini-window")
        fun edgeTab() = hostRoot.findViewWithTag<View>("call-edge-tab")
        fun returnToApp() = context.startActivity(Intent(context, MiniWindowHostActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        // The live drawer, whether open or in PiP; call on the main thread.
        fun drawer() = listOf(Stage.RESUMED, Stage.PAUSED).flatMap { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(it) }
            .filterIsInstance<CallActivity>().firstOrNull { !it.isFinishing }
        try {
            instrumentation.runOnMainSync { Calls.outgoing(context, offer) }
            instrumentation.awaitCondition("Native room did not connect") { Calls.state == "connected" }
            instrumentation.runOnMainSync { Calls.scope.launch { observer.connect(url, liveKitToken("mini-window-observer", room)) } }
            instrumentation.awaitCondition("Remote participant did not join") { Calls.room?.remoteParticipants?.isNotEmpty() == true }
            instrumentation.awaitCondition("Connecting must open the drawer") { Calls.overlay == "expanded" && drawer()?.hasWindowFocus() == true }
            instrumentation.runOnMainSync { Calls.scope.launch { Calls.camera(context, true) } }
            instrumentation.awaitCondition("Native camera did not start") { Calls.video }

            instrumentation.uiAutomation.executeShellCommand("input keyevent 4").close()
            instrumentation.awaitCondition("Back must shrink the drawer to the in-app thumbnail") {
                Calls.overlay == "minimized" && !CallActivity.isOpen && thumbnail().visibility == View.VISIBLE
            }
            instrumentation.screenshot("call-mini-window.png")
            instrumentation.runOnMainSync { assertTrue("The thumbnail keeps showing the camera", Calls.video) }

            instrumentation.runOnMainSync { thumbnail().performClick() }
            instrumentation.awaitCondition("Tapping the thumbnail must reopen the drawer") {
                Calls.overlay == "expanded" && thumbnail().visibility == View.GONE && drawer()?.hasWindowFocus() == true
            }
            instrumentation.uiAutomation.executeShellCommand("input keyevent 4").close()
            instrumentation.awaitCondition("Back must minimize again") { Calls.overlay == "minimized" && !CallActivity.isOpen }

            // Leaving the app from the thumbnail turns Macro's own window into the call's PiP.
            instrumentation.uiAutomation.executeShellCommand("input keyevent 3").close()
            instrumentation.awaitCondition("Leaving the app must continue the call in PiP") { host.isInPictureInPictureMode }
            // Mode callbacks precede completion of Android's pinned-task animation.
            Thread.sleep(1_000)
            instrumentation.screenshot("call-pip-from-mini-window.png")
            instrumentation.runOnMainSync {
                assertNotNull(hostRoot.findViewWithTag<View>("call-pip"))
                assertTrue("PiP keeps the camera", Calls.video)
            }

            returnToApp()
            instrumentation.awaitCondition("Expanding PiP must open the drawer, as iOS restores") {
                !host.isInPictureInPictureMode && Calls.overlay == "expanded" && drawer()?.hasWindowFocus() == true
            }

            // From the drawer, the drawer itself becomes PiP, and returning to the app reopens it.
            instrumentation.uiAutomation.executeShellCommand("input keyevent 3").close()
            instrumentation.awaitCondition("The drawer did not enter PiP") { drawer()?.isInPictureInPictureMode == true && Calls.overlay == "minimized" }
            returnToApp()
            instrumentation.awaitCondition("Returning to the app must reopen the drawer from its PiP") {
                drawer()?.isInPictureInPictureMode == false && drawer()?.hasWindowFocus() == true && Calls.overlay == "expanded"
            }
            instrumentation.uiAutomation.executeShellCommand("input keyevent 4").close()
            instrumentation.awaitCondition("Back must minimize the restored drawer") { thumbnail().visibility == View.VISIBLE && !CallActivity.isOpen }
            instrumentation.runOnMainSync { assertTrue("The thumbnail keeps the camera", Calls.video) }

            instrumentation.runOnMainSync {
                // Drag the thumbnail past the right edge, as on iOS, to tuck the call away.
                val view = thumbnail()
                val start = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, 0f, 0f, 0)
                val move = MotionEvent.obtain(0, 50, MotionEvent.ACTION_MOVE, hostRoot.width.toFloat(), 0f, 0)
                val end = MotionEvent.obtain(0, 100, MotionEvent.ACTION_UP, hostRoot.width.toFloat(), 0f, 0)
                listOf(start, move, end).forEach { view.dispatchTouchEvent(it); it.recycle() }
            }
            instrumentation.awaitCondition("Dragging past the edge must leave an edge tab") {
                Calls.overlay == "hidden" && thumbnail().visibility == View.GONE && edgeTab().visibility == View.VISIBLE
            }
            instrumentation.runOnMainSync { edgeTab().performClick() }
            instrumentation.awaitCondition("The edge tab must restore the thumbnail") { Calls.overlay == "minimized" && thumbnail().visibility == View.VISIBLE }

            instrumentation.uiAutomation.executeShellCommand("input keyevent 3").close()
            instrumentation.awaitCondition("The call did not enter PiP again") { host.isInPictureInPictureMode }
            // Remove the pinned task, as closing PiP does; the activity stops without expanding.
            instrumentation.uiAutomation.executeShellCommand("am stack remove ${host.taskId}").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            instrumentation.awaitCondition("Closing PiP must stop the camera") { !Calls.video }
            instrumentation.runOnMainSync {
                assertFalse("Closing PiP must not open the drawer", CallActivity.isOpen)
                assertEquals("Background audio must remain connected", "connected", Calls.state)
                Calls.end(context, offer.callId)
            }
        } finally {
            instrumentation.runOnMainSync {
                observer.disconnect(); observer.release(); Calls.end(context, offer.callId)
                host.finish()
            }
        }
    }
}
