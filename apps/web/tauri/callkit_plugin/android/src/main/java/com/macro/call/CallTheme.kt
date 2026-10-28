package com.macro.call

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import org.json.JSONObject

/** The same resolved semantic colors used by the iOS drawer, retained for cold rings. */
internal data class CallTheme(val drawer: Int, val text: Int, val tile: Int, val scrim: Int,
    val edgeMuted: Int, val edge: Int, val muted: Int, val failure: Int, val success: Int) {
    companion object {
        fun load(context: Context): CallTheme {
            val dark = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
            val fallback = if (dark) CallTheme(Color.rgb(16,16,16), Color.WHITE, Color.rgb(25,25,25), 0x99000000.toInt(),
                Color.rgb(46,46,46), Color.rgb(80,80,80), Color.LTGRAY, Color.rgb(235,65,65), Color.rgb(30,175,115))
                else CallTheme(Color.WHITE, Color.rgb(25,25,25), Color.rgb(245,245,245), 0x66000000,
                    Color.rgb(230,230,230), Color.rgb(205,205,205), Color.DKGRAY, Color.rgb(225,55,55), Color.rgb(20,145,95))
            return runCatching { parse(JSONObject(context.getSharedPreferences("macro_call_theme", Context.MODE_PRIVATE)
                .getString("theme", null) ?: return fallback)) }.getOrDefault(fallback)
        }
        fun parse(json: JSONObject): CallTheme {
            fun color(key: String): Int {
                val rgba = json.getJSONObject(key)
                fun channel(name: String) = (rgba.getDouble(name).also { require(it.isFinite() && it in 0.0..1.0) } * 255).toInt()
                return Color.argb(channel("alpha"), channel("red"), channel("green"), channel("blue"))
            }
            return CallTheme(color("drawerBackground"), color("text"), color("messageBackground"), color("overlayBackground"),
                color("edgeMuted"), color("edge"), color("inkMuted"), color("failure"), color("success"))
        }
    }
}
