package expo.modules.tumsafety

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.os.Bundle
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

class SafetyCameraPreviewActivity : Activity(), TextureView.SurfaceTextureListener {
  private lateinit var texture: TextureView
  private var camera: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var facing = "front"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    facing = intent.getStringExtra("camera_facing") ?: "front"
    window.statusBarColor = Color.BLACK
    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    texture = TextureView(this).apply { surfaceTextureListener = this@SafetyCameraPreviewActivity }
    root.addView(texture, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

    val top = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(18), dp(16), dp(18), dp(14))
      setBackgroundColor(0xCC000000.toInt())
    }
    val close = TextView(this).apply {
      text = "‹   PREVIEW · NÃO ESTÁ GRAVANDO"
      setTextColor(Color.WHITE); textSize = 15f; setOnClickListener { finish() }
    }
    val title = TextView(this).apply {
      text = "Ajuste a posição do celular"
      setTextColor(Color.WHITE); textSize = 20f; setPadding(0, dp(8), 0, 0)
    }
    top.addView(close); top.addView(title)
    root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

    val bottom = TextView(this).apply {
      text = "🛡 Confira o enquadramento antes da viagem. Durante a corrida a câmera não ficará aberta na tela; a gravação acontece em segundo plano."
      setTextColor(Color.WHITE); textSize = 14f; setPadding(dp(18), dp(14), dp(18), dp(18)); setBackgroundColor(0xD9000000.toInt())
    }
    root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    setContentView(root)
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) { openCamera() }
  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit
  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean { closeCamera(); return true }

  @Suppress("MissingPermission")
  private fun openCamera() {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { finish(); return }
    val manager = getSystemService(CameraManager::class.java)
    val target = if (facing == "back") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT
    val id = runCatching { manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == target } ?: manager.cameraIdList.first() }.getOrNull() ?: return
    manager.openCamera(id, object : CameraDevice.StateCallback() {
      override fun onOpened(device: CameraDevice) {
        camera = device
        val st = texture.surfaceTexture ?: return
        st.setDefaultBufferSize(texture.width.coerceAtLeast(640), texture.height.coerceAtLeast(480))
        val surface = Surface(st)
        device.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
          override fun onConfigured(s: CameraCaptureSession) {
            session = s
            val req = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(surface) }.build()
            s.setRepeatingRequest(req, null, null)
          }
          override fun onConfigureFailed(s: CameraCaptureSession) = Unit
        }, null)
      }
      override fun onDisconnected(device: CameraDevice) { device.close() }
      override fun onError(device: CameraDevice, error: Int) { device.close() }
    }, null)
  }

  private fun closeCamera() { runCatching { session?.close() }; session = null; runCatching { camera?.close() }; camera = null }
  override fun onPause() { closeCamera(); super.onPause() }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
