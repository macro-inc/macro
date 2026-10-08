package com.macro.call

import android.graphics.*
import android.graphics.drawable.Drawable

/** Small monochrome call controls, independent of the platform's button theme. */
internal class CallControlIcon(private val kind: String, color: Int, private val off: Boolean = false) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.STROKE; strokeWidth = 1.8f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    override fun draw(canvas: Canvas) {
        canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        when (kind) {
            "speaker" -> {
                canvas.drawPath(Path().apply { moveTo(3f,9f); lineTo(7f,9f); lineTo(12f,5f); lineTo(12f,19f); lineTo(7f,15f); lineTo(3f,15f); close() }, paint)
                canvas.drawArc(11f,7f,19f,17f,-60f,120f,false,paint)
                canvas.drawArc(9f,3f,23f,21f,-50f,100f,false,paint)
            }
            "mic" -> {
                canvas.drawRoundRect(9f,3f,15f,14f,3f,3f,paint)
                canvas.drawArc(6f,7f,18f,18f,0f,180f,false,paint)
                canvas.drawLine(12f,18f,12f,21f,paint); canvas.drawLine(9f,21f,15f,21f,paint)
            }
            "video" -> {
                canvas.drawRoundRect(3f,6f,16f,18f,2f,2f,paint)
                canvas.drawPath(Path().apply { moveTo(16f,10f); lineTo(21f,7f); lineTo(21f,17f); lineTo(16f,14f) },paint)
            }
            "switch" -> {
                canvas.drawArc(4f,4f,20f,20f,30f,140f,false,paint)
                canvas.drawArc(4f,4f,20f,20f,210f,140f,false,paint)
                canvas.drawLine(4f,12f,4f,17f,paint); canvas.drawLine(4f,17f,9f,17f,paint)
                canvas.drawLine(20f,12f,20f,7f,paint); canvas.drawLine(20f,7f,15f,7f,paint)
            }
        }
        if (off) canvas.drawLine(3f,3f,21f,21f,paint)
        canvas.restore()
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter; invalidateSelf() }
    @Deprecated("Deprecated in Android") override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
