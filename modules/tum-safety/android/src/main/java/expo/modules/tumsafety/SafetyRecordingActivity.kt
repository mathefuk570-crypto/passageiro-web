package expo.modules.tumsafety

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface

class SafetyRecordingActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private val prefs by lazy { getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE) }
  private val startedAt = SystemClock.elapsedRealtime()

  private val finishWhenReady = object : Runnable {
    override fun run() {
      val recording = prefs.getBoolean(SafetyRecordingService.PREF_RECORDING_ACTIVE, false)
      val error = prefs.getString(SafetyRecordingService.PREF_LAST_ERROR, null)
      val timedOut = SystemClock.elapsedRealtime() - startedAt >= 6_000L

      if (recording || !error.isNullOrBlank() || timedOut) {
        finishSilently()
      } else {
        handler.postDelayed(this, 120L)
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    overridePendingTransition(0, 0)

    // A rotação precisa ser capturada aqui (Activity = Context visual). Não tente
    // consultar display/window a partir do SafetyRecordingService: em Android novo
    // isso lança IllegalArgumentException porque Service é Context de background.
    val rotationDegrees = currentRotationDegrees()

    // Remove erro antigo para que a Activity espere o resultado desta tentativa e
    // entrega ao serviço a rotação já resolvida.
    prefs.edit()
      .remove(SafetyRecordingService.PREF_LAST_ERROR)
      .putInt(SafetyRecordingService.PREF_DEVICE_ROTATION_DEGREES, rotationDegrees)
      .apply()

    val serviceIntent = Intent(this, SafetyRecordingService::class.java).apply {
      action = SafetyRecordingService.ACTION_START_RECORDING
    }

    val started = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent)
      else startService(serviceIntent)
    }.isSuccess

    if (!started) {
      prefs.edit().putString(
        SafetyRecordingService.PREF_LAST_ERROR,
        "O Android não permitiu iniciar a gravação de segurança."
      ).apply()
      finishSilently()
      return
    }

    // Mantém apenas esta janela transparente ativa durante o bootstrap da câmera/
    // microfone. Visualmente o app que estava aberto (ex.: Google Maps) permanece.
    handler.post(finishWhenReady)
  }

  @Suppress("DEPRECATION")
  private fun currentRotationDegrees(): Int {
    // windowManager pertence à Activity e, portanto, é associado a um Display válido.
    val rotation = windowManager.defaultDisplay.rotation
    return when (rotation) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
  }

  private fun finishSilently() {
    handler.removeCallbacks(finishWhenReady)
    if (!isFinishing) {
      finish()
      overridePendingTransition(0, 0)
    }
  }

  override fun onDestroy() {
    handler.removeCallbacks(finishWhenReady)
    super.onDestroy()
  }
}
