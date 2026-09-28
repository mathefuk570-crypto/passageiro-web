package expo.modules.tumsafety

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TumSafetyModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private val prefs get() = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("TumSafety")

    AsyncFunction("getCompatibility") {
      val cameraManager = context.getSystemService(CameraManager::class.java)
      var front = false
      var back = false
      runCatching {
        cameraManager.cameraIdList.forEach { id ->
          when (cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)) {
            CameraCharacteristics.LENS_FACING_FRONT -> front = true
            CameraCharacteristics.LENS_FACING_BACK -> back = true
          }
        }
      }
      mapOf(
        "platform" to "android",
        "cameraPermission" to (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED),
        "microphonePermission" to (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED),
        "videoSupported" to (front || back),
        "audioSupported" to true,
        "frontCamera" to front,
        "backCamera" to back,
        "backgroundRecording" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O),
        "continuousSegments" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O),
      )
    }

    AsyncFunction("configureRideContext") { input: Map<String, Any?> ->
      val authUserId = input["authUserId"]?.toString().orEmpty()
      val rideId = input["rideId"]?.toString().orEmpty()
      val url = input["supabaseUrl"]?.toString().orEmpty().trimEnd('/')
      val anon = input["anonKey"]?.toString().orEmpty()
      val access = input["accessToken"]?.toString().orEmpty()
      if (authUserId.isBlank() || rideId.isBlank() || url.isBlank() || anon.isBlank() || access.isBlank()) return@AsyncFunction false

      prefs.edit()
        .putString(SafetyRecordingService.PREF_AUTH_USER_ID, authUserId)
        .putString(SafetyRecordingService.PREF_RIDE_ID, rideId)
        .putBoolean(SafetyRecordingService.PREF_RIDE_ENDED, false)
        .putString(SafetyRecordingService.PREF_CAMERA_FACING, input["cameraFacing"]?.toString() ?: "front")
        .putString(SafetyRecordingService.PREF_CAPTURE_MODE, input["captureMode"]?.toString() ?: "video_audio")
        .putString(SafetyRecordingService.PREF_QUALITY_PRESET, input["qualityPreset"]?.toString() ?: "balanced")
        .putInt(SafetyRecordingService.PREF_SEGMENT_TARGET_MB, (input["segmentTargetMb"] as? Number)?.toInt()?.coerceIn(4, 20) ?: 8)
        .putBoolean(SafetyRecordingService.PREF_MOBILE_UPLOAD_ENABLED, input["mobileUploadEnabled"] as? Boolean ?: true)
        .putBoolean(SafetyRecordingService.PREF_FEATURE_ENABLED, input["featureEnabled"] as? Boolean ?: false)
        .putString(SafetyRecordingService.PREF_SUPABASE_URL, url)
        .putString(SafetyRecordingService.PREF_ANON_KEY, anon)
        .putString(SafetyRecordingService.PREF_DEVICE_MODEL, input["deviceModel"]?.toString().orEmpty())
        .putString(SafetyRecordingService.PREF_APP_VERSION, input["appVersion"]?.toString().orEmpty())
        .remove(SafetyRecordingService.PREF_LAST_ERROR)
        .apply()
      SafetySecretStore.put(context, SafetyRecordingService.PREF_ACCESS_TOKEN, access)
      SafetySecretStore.put(context, SafetyRecordingService.PREF_REFRESH_TOKEN, input["refreshToken"]?.toString().orEmpty())
      if (SafetyUploadQueue.hasQueuedWork(context)) SafetyUploadWorker.schedule(context)
      true
    }

    AsyncFunction("clearRideContext") {
      val recording = prefs.getBoolean(SafetyRecordingService.PREF_RECORDING_ACTIVE, false)
      val edit = prefs.edit().putBoolean(SafetyRecordingService.PREF_RIDE_ENDED, true)
      if (!recording) {
        edit.remove(SafetyRecordingService.PREF_RIDE_ID)
          .putBoolean(SafetyRecordingService.PREF_FEATURE_ENABLED, false)
          .putBoolean(SafetyRecordingService.PREF_RIDE_ENDED, false)
      }
      edit.apply()
      if (SafetyUploadQueue.hasQueuedWork(context)) SafetyUploadWorker.schedule(context)
      true
    }

    AsyncFunction("startRecording") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction false
      if (prefs.getBoolean(SafetyRecordingService.PREF_RIDE_ENDED, false)) return@AsyncFunction false
      if (!prefs.getBoolean(SafetyRecordingService.PREF_FEATURE_ENABLED, false) || prefs.getString(SafetyRecordingService.PREF_RIDE_ID, "").isNullOrBlank()) return@AsyncFunction false
      if (prefs.getBoolean(SafetyRecordingService.PREF_RECORDING_ACTIVE, false)) return@AsyncFunction true

      // Inicia por uma Activity transparente. Além de evitar o mesmo problema de
      // Context/display encontrado no Motorista, isso garante que Android 14+ veja
      // um contexto visual válido no instante em que o foreground service de
      // câmera/microfone é criado. A Activity fecha sozinha e não abre a UI do TUM.
      prefs.edit().remove(SafetyRecordingService.PREF_LAST_ERROR).apply()
      val started = runCatching {
        context.startActivity(Intent(context, SafetyRecordingActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        })
      }.isSuccess

      if (!started) {
        prefs.edit().putString(SafetyRecordingService.PREF_LAST_ERROR, "O Android não permitiu preparar a gravação de segurança.").apply()
      }
      started
    }

    AsyncFunction("stopRecording") {
      val intent = Intent(context, SafetyRecordingService::class.java).apply { action = SafetyRecordingService.ACTION_STOP_RECORDING }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      true
    }

    AsyncFunction("retryPendingUploads") {
      SafetyUploadWorker.schedule(context)
      true
    }

    AsyncFunction("getStatus") {
      mapOf(
        "featureEnabled" to prefs.getBoolean(SafetyRecordingService.PREF_FEATURE_ENABLED, false),
        "rideId" to prefs.getString(SafetyRecordingService.PREF_RIDE_ID, null),
        "recording" to prefs.getBoolean(SafetyRecordingService.PREF_RECORDING_ACTIVE, false),
        "recordingId" to prefs.getString(SafetyRecordingService.PREF_RECORDING_ID, null),
        "startedAt" to prefs.getLong(SafetyRecordingService.PREF_RECORDING_STARTED_AT, 0L).takeIf { it > 0 },
        "pendingSegments" to prefs.getInt(SafetyRecordingService.PREF_PENDING_SEGMENTS, 0),
        "lastError" to prefs.getString(SafetyRecordingService.PREF_LAST_ERROR, null),
        "cameraFacing" to (prefs.getString(SafetyRecordingService.PREF_CAMERA_FACING, "front") ?: "front"),
        "captureMode" to (prefs.getString(SafetyRecordingService.PREF_CAPTURE_MODE, "video_audio") ?: "video_audio"),
      )
    }

    AsyncFunction("beginGalleryUnlock") {
      prefs.edit().putLong(SafetyRecordingService.PREF_GALLERY_UNLOCK_RESULT_AT, 0L).putBoolean(SafetyRecordingService.PREF_GALLERY_UNLOCK_SUCCESS, false).apply()
      context.startActivity(Intent(context, SafetyGalleryUnlockActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    AsyncFunction("getGalleryUnlockState") {
      val unlockedAt = prefs.getLong(SafetyRecordingService.PREF_GALLERY_UNLOCKED_AT, 0L)
      val now = System.currentTimeMillis()
      mapOf(
        "unlocked" to (unlockedAt > 0 && now - unlockedAt <= 120_000L),
        "success" to prefs.getBoolean(SafetyRecordingService.PREF_GALLERY_UNLOCK_SUCCESS, false),
        "resultAt" to prefs.getLong(SafetyRecordingService.PREF_GALLERY_UNLOCK_RESULT_AT, 0L),
      )
    }

    AsyncFunction("lockGallery") {
      prefs.edit().remove(SafetyRecordingService.PREF_GALLERY_UNLOCKED_AT).apply()
      true
    }

    AsyncFunction("openCameraPreview") { cameraFacing: String ->
      if (prefs.getBoolean(SafetyRecordingService.PREF_RECORDING_ACTIVE, false)) return@AsyncFunction false
      context.startActivity(Intent(context, SafetyCameraPreviewActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        putExtra("camera_facing", if (cameraFacing == "back") "back" else "front")
      })
      true
    }
  }
}
