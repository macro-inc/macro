package com.macro.editor

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.text.style.ReplacementSpan
import kotlin.math.ceil

/** The model keeps a single atomic character; drawing never rewrites its UTF-16 positions. */
internal class NativeDecoratorSpan(val label: String) : ReplacementSpan() {
    init {
        if (Build.VERSION.SDK_INT >= 30) contentDescription = label
    }

    override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int,
        metrics: Paint.FontMetricsInt?): Int {
        paint.getFontMetricsInt(metrics)
        return ceil(paint.measureText(label) + paint.textSize * 0.5f).toInt()
    }

    override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float,
        top: Int, y: Int, bottom: Int, paint: Paint) {
        val color = paint.color
        val style = paint.style
        val padding = paint.textSize * 0.25f
        try {
            paint.style = Paint.Style.FILL
            paint.color = (color and 0x00ffffff) or (24 shl 24)
            val metrics = paint.fontMetrics
            val rect = RectF(x, y + metrics.ascent, x + paint.measureText(label) + padding * 2,
                y + metrics.descent)
            canvas.drawRoundRect(rect, padding, padding, paint)
            paint.color = color
            canvas.drawText(label, x + padding, y.toFloat(), paint)
        } finally {
            paint.color = color
            paint.style = style
        }
    }
}
