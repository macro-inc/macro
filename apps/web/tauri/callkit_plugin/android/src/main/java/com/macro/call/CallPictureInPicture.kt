package com.macro.call

import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import io.livekit.android.room.track.VideoTrack

/** Shared by the drawer's PiP (CallActivity) and the mini-window's PiP (Macro's main activity). */
internal object CallPictureInPicture {
    private val dark = Color.rgb(15, 15, 15)

    // System PiP shows these instead of the call service's media-session transport controls.
    fun params(ctx: Context, sourceRect: Rect? = null, autoEnter: Boolean = false): PictureInPictureParams {
        val id = Calls.offer?.callId.orEmpty()
        val mute = if (Calls.muted) "Unmute" else "Mute"
        val actions = listOf(
            RemoteAction(Icon.createWithResource(ctx, if (Calls.muted) R.drawable.macro_call_microphone_slash else R.drawable.macro_call_microphone),
                mute, mute, CallService.action(ctx, "mute", id)),
            RemoteAction(Icon.createWithResource(ctx, R.drawable.macro_call_phone_disconnect), "Leave", "Leave call", CallService.action(ctx, "end", id)),
        )
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(32, 15)).setActions(actions).setSourceRectHint(sourceRect)
        if (Build.VERSION.SDK_INT >= 31) builder.setAutoEnterEnabled(autoEnter)
        return builder.build()
    }

    /** Matches iOS: you on the left and the active speaker on the right, video or initials over the name. */
    fun view(ctx: Context, localTitle: String, localTrack: VideoTrack?, remoteTitle: String?, remoteTrack: VideoTrack?,
        video: (VideoTrack, Boolean) -> View): View = LinearLayout(ctx).apply {
        tag = "call-pip"
        setBackgroundColor(dark)
        val density = ctx.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        fun tile(title: String, track: VideoTrack?, mirror: Boolean) = FrameLayout(ctx).apply {
            setBackgroundColor(dark)
            if (track != null) {
                addView(video(track, mirror), FrameLayout.LayoutParams(-1, -1))
                return@apply
            }
            val placeholder = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
            placeholder.addView(TextView(ctx).apply {
                text = Calls.initials(title); textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(46, 46, 46)) }
            }, LinearLayout.LayoutParams(dp(44), dp(44)))
            placeholder.addView(TextView(ctx).apply {
                text = title; textSize = 10f; setTextColor(Color.argb(224, 255, 255, 255)); gravity = Gravity.CENTER
                maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(5) })
            addView(placeholder, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply { leftMargin = dp(8); rightMargin = dp(8) })
        }
        addView(tile(localTitle, localTrack, true), LinearLayout.LayoutParams(0, -1, 1f))
        addView(View(ctx).apply { setBackgroundColor(Color.argb(46, 255, 255, 255)) }, LinearLayout.LayoutParams(dp(1), -1))
        addView(tile(remoteTitle ?: "No one else is here", remoteTrack, false), LinearLayout.LayoutParams(0, -1, 1f))
    }
}
