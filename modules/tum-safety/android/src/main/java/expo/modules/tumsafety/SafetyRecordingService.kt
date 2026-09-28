package expo.modules.tumsafety

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.params.StreamConfigurationMap
import android.media.CamcorderProfile
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.Size
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

class SafetyRecordingService : Service() {
  companion object {
    const val ACTION_START_RECORDING = "expo.modules.tumsafety.START_RECORDING"
    const val ACTION_STOP_RECORDING = "expo.modules.tumsafety.STOP_RECORDING"
    const val ACTION_RETRY_UPLOADS = "expo.modules.tumsafety.RETRY_UPLOADS"

    const val PREFS_NAME = "tum_safety_recording"
    const val PREF_AUTH_USER_ID = "auth_user_id"
    const val PREF_RIDE_ID = "ride_id"
    const val PREF_RIDE_ENDED = "ride_ended"
    const val PREF_CAMERA_FACING = "camera_facing"
    const val PREF_CAPTURE_MODE = "capture_mode"
    const val PREF_QUALITY_PRESET = "quality_preset"
    const val PREF_SEGMENT_TARGET_MB = "segment_target_mb"
    const val PREF_MOBILE_UPLOAD_ENABLED = "mobile_upload_enabled"
    const val PREF_FEATURE_ENABLED = "feature_enabled"
    const val PREF_SUPABASE_URL = "supabase_url"
    const val PREF_ANON_KEY = "anon_key"
    const val PREF_ACCESS_TOKEN = "access_token"
    const val PREF_REFRESH_TOKEN = "refresh_token"
    const val PREF_DEVICE_MODEL = "device_model"
    const val PREF_APP_VERSION = "app_version"
    const val PREF_RECORDING_ACTIVE = "recording_active"
    const val PREF_RECORDING_ID = "recording_id"
    const val PREF_RECORDING_STARTED_AT = "recording_started_at"
    const val PREF_DEVICE_ROTATION_DEGREES = "device_rotation_degrees"
    const val PREF_PENDING_SEGMENTS = "pending_segments"
    const val PREF_LAST_ERROR = "last_error"
    const val PREF_GALLERY_UNLOCKED_AT = "gallery_unlocked_at"
    const val PREF_GALLERY_UNLOCK_RESULT_AT = "gallery_unlock_result_at"
    const val PREF_GALLERY_UNLOCK_SUCCESS = "gallery_unlock_success"

    private const val CHANNEL_ID = "tum-safety-recording-v1"
    private const val NOTIFICATION_ID = 9410
    private const val STOP_REQUEST_ID = 9411
  }

  private val prefs by lazy { getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }
  private val io = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)
  private val stopping = AtomicBoolean(false)
  private lateinit var cameraThread: HandlerThread
  private lateinit var cameraHandler: Handler
  private var recorder: MediaRecorder? = null
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var currentFile: File? = null
  private var currentSequence = 0
  private var currentSegmentStartedAt = 0L
  private var recordingId: String? = null
  private val rideEndedListener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key == PREF_RIDE_ENDED && prefs.getBoolean(PREF_RIDE_ENDED, false) && prefs.getBoolean(PREF_RECORDING_ACTIVE, false)) {
      beginStop()
    }
  }

  override fun onCreate() {
    super.onCreate()
    createChannel()
    cameraThread = HandlerThread("TumSafetyCamera").apply { start() }
    cameraHandler = Handler(cameraThread.looper)
    prefs.registerOnSharedPreferenceChangeListener(rideEndedListener)
    SafetyUploadQueue.updatePendingCount(this)
    if (SafetyUploadQueue.hasQueuedWork(this)) SafetyUploadWorker.schedule(this)
    if (prefs.getBoolean(PREF_RECORDING_ACTIVE, false)) {
      val interruptedId = prefs.getString(PREF_RECORDING_ID, null)
      prefs.edit().putBoolean(PREF_RECORDING_ACTIVE, false).putString(PREF_LAST_ERROR, "A gravação anterior foi interrompida pelo sistema. Os trechos já salvos continuam protegidos.").apply()
      if (!interruptedId.isNullOrBlank()) {
        markEnded(interruptedId)
        io.execute {
          try {
            runCatching { rpc("stop_safety_recording_tum", JSONObject().put("p_recording_id", interruptedId).put("p_ended_at", utcNow())) }
            runCatching { retryPendingUploadsInternal() }
            runCatching { completeIfReady(interruptedId) }
          } finally {
            val endedRide = prefs.getBoolean(PREF_RIDE_ENDED, false)
            val editor = prefs.edit().remove(PREF_RECORDING_ID).remove(PREF_RECORDING_STARTED_AT)
            if (endedRide) editor.remove(PREF_RIDE_ID).putBoolean(PREF_FEATURE_ENABLED, false).putBoolean(PREF_RIDE_ENDED, false)
            editor.apply()
            updatePendingCount()
            if (SafetyUploadQueue.hasQueuedWork(this@SafetyRecordingService)) SafetyUploadWorker.schedule(this@SafetyRecordingService)
          }
        }
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START_RECORDING -> beginStart()
      ACTION_STOP_RECORDING -> beginStop()
      ACTION_RETRY_UPLOADS -> beginRetryUploads()
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    runCatching { prefs.unregisterOnSharedPreferenceChangeListener(rideEndedListener) }
    val wasActive = prefs.getBoolean(PREF_RECORDING_ACTIVE, false)
    val interruptedId = recordingId ?: prefs.getString(PREF_RECORDING_ID, null)
    if (wasActive) {
      runCatching { stopCapture(finalize = true) }
      prefs.edit()
        .putBoolean(PREF_RECORDING_ACTIVE, false)
        .putString(PREF_LAST_ERROR, "A gravação foi interrompida pelo Android. Os trechos salvos entrarão na fila de proteção.")
        .apply()
      if (!interruptedId.isNullOrBlank()) markEnded(interruptedId)
      SafetyUploadQueue.updatePendingCount(this)
      if (SafetyUploadQueue.hasQueuedWork(this)) SafetyUploadWorker.schedule(this)
    } else {
      runCatching { stopCapture(finalize = false) }
    }
    runCatching { cameraThread.quitSafely() }
    runCatching { io.shutdown() }
    releaseWakeLock()
    super.onDestroy()
  }

  private fun beginStart() {
    if (!busy.compareAndSet(false, true)) return
    startForeground(NOTIFICATION_ID, buildNotification("Preparando gravação de segurança…"))
    io.execute {
      try {
        if (prefs.getBoolean(PREF_RECORDING_ACTIVE, false)) return@execute
        validatePermissionsAndContext()
        retryPendingUploadsInternal()
        val result = rpc("start_safety_recording_tum", JSONObject()
          .put("p_ride_id", prefs.getString(PREF_RIDE_ID, ""))
          .put("p_camera_facing", prefs.getString(PREF_CAMERA_FACING, "front"))
          .put("p_capture_mode", prefs.getString(PREF_CAPTURE_MODE, "video_audio"))
          .put("p_device_platform", "android")
          .put("p_device_model", prefs.getString(PREF_DEVICE_MODEL, ""))
          .put("p_app_version", prefs.getString(PREF_APP_VERSION, "")))
        val id = result.optString("id")
        if (id.isBlank()) error("O servidor não criou a gravação.")
        recordingId = id
        currentSequence = nextSequence(id)
        prefs.edit()
          .putString(PREF_RECORDING_ID, id)
          .putLong(PREF_RECORDING_STARTED_AT, System.currentTimeMillis())
          .putBoolean(PREF_RECORDING_ACTIVE, true)
          .remove(PREF_LAST_ERROR)
          .apply()
        acquireWakeLock()
        cameraHandler.post {
          try {
            startCapture(id)
          } catch (e: Exception) {
            failRecording(e.message ?: "Não foi possível iniciar a captura.")
          }
        }
      } catch (e: Exception) {
        prefs.edit().putString(PREF_LAST_ERROR, e.message ?: "Falha ao iniciar gravação.").apply()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      } finally { busy.set(false) }
    }
  }

  private fun beginStop() {
    if (!stopping.compareAndSet(false, true)) return
    startForeground(NOTIFICATION_ID, buildNotification("Finalizando gravação…"))
    cameraHandler.post {
      val id = recordingId ?: prefs.getString(PREF_RECORDING_ID, null)
      runCatching { stopCapture(finalize = true) }
      prefs.edit().putBoolean(PREF_RECORDING_ACTIVE, false).apply()
      releaseWakeLock()
      if (id.isNullOrBlank()) {
        val endedRide = prefs.getBoolean(PREF_RIDE_ENDED, false)
        val editor = prefs.edit().putBoolean(PREF_RECORDING_ACTIVE, false)
        if (endedRide) editor.remove(PREF_RIDE_ID).putBoolean(PREF_FEATURE_ENABLED, false).putBoolean(PREF_RIDE_ENDED, false)
        editor.apply()
        stopping.set(false)
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return@post
      }
      markEnded(id)
      io.execute {
        try {
          runCatching { rpc("stop_safety_recording_tum", JSONObject().put("p_recording_id", id).put("p_ended_at", utcNow())) }
          retryPendingUploadsInternal()
          completeIfReady(id)
        } catch (e: Exception) {
          prefs.edit().putString(PREF_LAST_ERROR, e.message ?: "Os arquivos ficaram na fila para envio.").apply()
        } finally {
          val endedRide = prefs.getBoolean(PREF_RIDE_ENDED, false)
          val editor = prefs.edit().remove(PREF_RECORDING_ID).remove(PREF_RECORDING_STARTED_AT)
          if (endedRide) editor.remove(PREF_RIDE_ID).putBoolean(PREF_FEATURE_ENABLED, false).putBoolean(PREF_RIDE_ENDED, false)
          editor.apply()
          updatePendingCount()
          if (SafetyUploadQueue.hasQueuedWork(this@SafetyRecordingService)) SafetyUploadWorker.schedule(this@SafetyRecordingService)
          stopping.set(false)
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        }
      }
    }
  }

  private fun beginRetryUploads() {
    if (!busy.compareAndSet(false, true)) return
    startForeground(NOTIFICATION_ID, buildNotification("Protegendo gravações pendentes…"))
    io.execute {
      try { retryPendingUploadsInternal() }
      finally {
        busy.set(false)
        if (!prefs.getBoolean(PREF_RECORDING_ACTIVE, false)) {
          stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
        }
      }
    }
  }

  private fun validatePermissionsAndContext() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) error("A gravação contínua de segurança exige Android 8 ou superior.")
    if (!prefs.getBoolean(PREF_FEATURE_ENABLED, false)) error("Ative a gravação de segurança primeiro.")
    if (prefs.getBoolean(PREF_RIDE_ENDED, false)) error("A corrida já foi encerrada.")
    if (prefs.getString(PREF_RIDE_ID, "").isNullOrBlank()) error("Nenhuma corrida ativa configurada.")
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) error("Permissão de microfone necessária.")
    if (prefs.getString(PREF_CAPTURE_MODE, "video_audio") != "audio_only" && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) error("Permissão de câmera necessária.")
  }

  private fun startCapture(id: String) {
    val mode = prefs.getString(PREF_CAPTURE_MODE, "video_audio") ?: "video_audio"
    if (mode == "audio_only") {
      startAudioCapture(id)
      updateNotification("Gravação de segurança ativa")
    } else {
      startVideoCapture(id)
    }
  }

  private fun newRecorder(): MediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()

  private fun startAudioCapture(id: String) {
    val rec = newRecorder()
    recorder = rec
    currentFile = segmentFile(id, currentSequence, false)
    currentSegmentStartedAt = System.currentTimeMillis()
    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
    rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    rec.setAudioEncodingBitRate(if (quality() == "data_saver") 48_000 else 64_000)
    rec.setAudioSamplingRate(44_100)
    rec.setOutputFile(currentFile!!.absolutePath)
    configureSegmentation(rec, id, false)
    rec.prepare()
    rec.start()
  }

  @Suppress("MissingPermission", "DEPRECATION")
  private fun startVideoCapture(id: String) {
    val manager = getSystemService(CameraManager::class.java)
    val desired = if (prefs.getString(PREF_CAMERA_FACING, "front") == "back") {
      CameraCharacteristics.LENS_FACING_BACK
    } else {
      CameraCharacteristics.LENS_FACING_FRONT
    }

    val cameraId = manager.cameraIdList.firstOrNull {
      manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == desired
    } ?: manager.cameraIdList.firstOrNull() ?: error("Nenhuma câmera disponível.")

    val characteristics = manager.getCameraCharacteristics(cameraId)
    val streamMap = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    val profile = chooseCamcorderProfile(cameraId, streamMap)

    val rec = newRecorder()
    recorder = rec
    currentFile = segmentFile(id, currentSequence, true)
    currentSegmentStartedAt = System.currentTimeMillis()

    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
    rec.setVideoSource(MediaRecorder.VideoSource.SURFACE)

    val configDescription: String
    if (profile != null) {
      // Usa uma combinação de resolução/FPS/codecs que o próprio aparelho declara
      // como válida para esta câmera. Isso evita configurações manuais que alguns
      // Samsung rejeitam no MediaRecorder/Camera2.
      rec.setProfile(profile)

      // O CamcorderProfile garante uma combinação compatível de resolução/FPS/codecs,
      // porém alguns aparelhos (especialmente Samsung) anunciam bitrates muito altos.
      // Mantemos o perfil para compatibilidade e sobrescrevemos apenas os bitrates
      // para uma gravação de segurança muito mais leve.
      val cappedVideoBitrate = when (quality()) {
        "data_saver" -> 650_000
        "clear" -> 2_200_000
        else -> 1_200_000
      }
      rec.setVideoEncodingBitRate(cappedVideoBitrate)
      rec.setAudioEncodingBitRate(if (quality() == "data_saver") 48_000 else 64_000)

      configDescription = "${profile.videoFrameWidth}x${profile.videoFrameHeight}@${profile.videoFrameRate}fps/profile/${cappedVideoBitrate / 1000}kbps"
    } else {
      val size = chooseVideoSize(streamMap)
      val preset = quality()
      rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      rec.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      rec.setVideoEncodingBitRate(when (preset) {
        "data_saver" -> 650_000
        "clear" -> 2_200_000
        else -> 1_200_000
      })
      // 30 fps é muito mais amplamente anunciado pelos perfis de câmera que 15 fps.
      rec.setVideoFrameRate(30)
      rec.setVideoSize(size.width, size.height)
      rec.setAudioEncodingBitRate(if (preset == "data_saver") 48_000 else 64_000)
      rec.setAudioSamplingRate(44_100)
      configDescription = "${size.width}x${size.height}@30fps/fallback"
    }

    rec.setOutputFile(currentFile!!.absolutePath)
    rec.setOrientationHint(calculateOrientationHint(characteristics, desired))
    configureSegmentation(rec, id, true)
    rec.setOnErrorListener { _, what, extra ->
      cameraHandler.post {
        failRecording("Erro do gravador de vídeo ($what/$extra) — $configDescription")
      }
    }

    try {
      rec.prepare()
    } catch (e: Exception) {
      throw IllegalStateException("Falha ao preparar vídeo ($configDescription): ${e.message ?: e.javaClass.simpleName}", e)
    }

    manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
      override fun onOpened(camera: CameraDevice) {
        if (stopping.get() || !prefs.getBoolean(PREF_RECORDING_ACTIVE, false)) {
          camera.close()
          return
        }
        cameraDevice = camera
        val surface = rec.surface
        try {
          camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) {
              if (stopping.get() || !prefs.getBoolean(PREF_RECORDING_ACTIVE, false)) {
                session.close()
                camera.close()
                return
              }
              captureSession = session
              try {
                val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                  addTarget(surface)
                }.build()
                session.setRepeatingRequest(request, null, cameraHandler)
                rec.start()
                updateNotification("Gravação de segurança ativa")
              } catch (e: Exception) {
                failRecording("Falha ao iniciar vídeo ($configDescription): ${e.message ?: e.javaClass.simpleName}")
              }
            }

            override fun onConfigureFailed(session: CameraCaptureSession) {
              failRecording("Falha ao configurar a câmera ($configDescription).")
            }
          }, cameraHandler)
        } catch (e: Exception) {
          failRecording("Falha ao criar sessão da câmera ($configDescription): ${e.message ?: e.javaClass.simpleName}")
        }
      }

      override fun onDisconnected(camera: CameraDevice) {
        camera.close()
        failRecording("Câmera desconectada ($configDescription).")
      }

      override fun onError(camera: CameraDevice, error: Int) {
        camera.close()
        val reason = when (error) {
          CameraDevice.StateCallback.ERROR_CAMERA_IN_USE -> "câmera em uso por outro aplicativo"
          CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE -> "limite de câmeras em uso"
          CameraDevice.StateCallback.ERROR_CAMERA_DISABLED -> "câmera desativada pelo sistema"
          CameraDevice.StateCallback.ERROR_CAMERA_DEVICE -> "falha no dispositivo de câmera"
          CameraDevice.StateCallback.ERROR_CAMERA_SERVICE -> "falha no serviço de câmera"
          else -> "código $error"
        }
        failRecording("Não foi possível abrir a câmera: $reason ($configDescription).")
      }
    }, cameraHandler)
  }

  @Suppress("DEPRECATION")
  private fun chooseCamcorderProfile(cameraId: String, map: StreamConfigurationMap?): CamcorderProfile? {
    val numericId = cameraId.toIntOrNull() ?: return null
    val preferred = when (quality()) {
      "data_saver" -> CamcorderProfile.QUALITY_480P
      "clear" -> CamcorderProfile.QUALITY_1080P
      else -> CamcorderProfile.QUALITY_720P
    }
    val candidates = listOf(
      preferred,
      CamcorderProfile.QUALITY_720P,
      CamcorderProfile.QUALITY_480P,
      CamcorderProfile.QUALITY_LOW,
    ).distinct()
    val supportedSizes = map?.getOutputSizes(MediaRecorder::class.java)?.toList().orEmpty()

    for (quality in candidates) {
      if (!runCatching { CamcorderProfile.hasProfile(numericId, quality) }.getOrDefault(false)) continue
      val profile = runCatching { CamcorderProfile.get(numericId, quality) }.getOrNull() ?: continue
      val sizeAdvertised = supportedSizes.isEmpty() || supportedSizes.any {
        it.width == profile.videoFrameWidth && it.height == profile.videoFrameHeight
      }
      if (sizeAdvertised) return profile
    }
    return null
  }

  private fun configureSegmentation(rec: MediaRecorder, id: String, video: Boolean) {
    val maxBytes = prefs.getInt(PREF_SEGMENT_TARGET_MB, 8).coerceIn(4, 20).toLong() * 1024L * 1024L
    rec.setMaxFileSize(maxBytes)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      rec.setOnInfoListener { mediaRecorder, what, _ ->
        if (what == 802) { // MAX_FILESIZE_APPROACHING
          runCatching {
            val next = segmentFile(id, currentSequence + 1, video)
            mediaRecorder.setNextOutputFile(next)
          }
        } else if (what == 803) { // NEXT_OUTPUT_FILE_STARTED
          val finished = currentFile
          val started = currentSegmentStartedAt
          val ended = System.currentTimeMillis()
          if (finished != null && finished.exists()) finalizeSegment(id, currentSequence, finished, started, ended, video)
          currentSequence += 1
          currentFile = segmentFile(id, currentSequence, video)
          currentSegmentStartedAt = ended
        }
      }
    }
  }

  private fun stopCapture(finalize: Boolean) {
    val id = recordingId ?: prefs.getString(PREF_RECORDING_ID, null)
    val file = currentFile
    val started = currentSegmentStartedAt
    val video = prefs.getString(PREF_CAPTURE_MODE, "video_audio") != "audio_only"
    runCatching { captureSession?.stopRepeating() }
    runCatching { captureSession?.close() }; captureSession = null
    runCatching { cameraDevice?.close() }; cameraDevice = null
    val rec = recorder
    recorder = null
    if (rec != null) {
      runCatching { rec.stop() }
      runCatching { rec.reset() }
      runCatching { rec.release() }
    }
    if (finalize && !id.isNullOrBlank() && file != null && file.exists() && file.length() > 0) {
      finalizeSegment(id, currentSequence, file, started, System.currentTimeMillis(), video)
    }
    currentFile = null
  }

  private fun failRecording(message: String) {
    if (!stopping.compareAndSet(false, true)) return
    runCatching { stopCapture(finalize = true) }
    prefs.edit().putBoolean(PREF_RECORDING_ACTIVE, false).putString(PREF_LAST_ERROR, message).apply()
    releaseWakeLock()
    val id = recordingId ?: prefs.getString(PREF_RECORDING_ID, null)
    if (id.isNullOrBlank()) {
      stopping.set(false)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    markEnded(id)
    updateNotification("Gravação interrompida — protegendo trechos salvos")
    io.execute {
      try {
        runCatching { rpc("stop_safety_recording_tum", JSONObject().put("p_recording_id", id).put("p_ended_at", utcNow())) }
        retryPendingUploadsInternal()
        completeIfReady(id)
      } finally {
        val endedRide = prefs.getBoolean(PREF_RIDE_ENDED, false)
        val editor = prefs.edit().remove(PREF_RECORDING_ID).remove(PREF_RECORDING_STARTED_AT)
        if (endedRide) editor.remove(PREF_RIDE_ID).putBoolean(PREF_FEATURE_ENABLED, false).putBoolean(PREF_RIDE_ENDED, false)
        editor.apply()
        updatePendingCount()
        if (SafetyUploadQueue.hasQueuedWork(this@SafetyRecordingService)) SafetyUploadWorker.schedule(this@SafetyRecordingService)
        stopping.set(false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
  }

  private fun finalizeSegment(id: String, sequence: Int, file: File, started: Long, ended: Long, video: Boolean) {
    if (!file.exists() || file.length() <= 0) return
    val meta = JSONObject()
      .put("recording_id", id)
      .put("auth_user_id", prefs.getString(PREF_AUTH_USER_ID, "").orEmpty())
      .put("sequence", sequence)
      .put("local_path", file.absolutePath)
      .put("mime_type", if (video) "video/mp4" else "audio/mp4")
      .put("byte_size", file.length())
      .put("duration_ms", max(0L, ended - started))
      .put("segment_started_at", utcFromMillis(started))
      .put("segment_ended_at", utcFromMillis(ended))
    File(file.parentFile, file.name + ".meta.json").writeText(meta.toString())
    updatePendingCount()
    SafetyUploadWorker.schedule(this)
    io.execute { runCatching { retryPendingUploadsInternal() } }
  }

  private fun retryPendingUploadsInternal() {
    val result = SafetyUploadQueue.flush(this)
    if (result.queuedWork && result.retryableForCurrentSession) SafetyUploadWorker.schedule(this)
  }

  private fun markEnded(id: String) {
    val marker = JSONObject()
      .put("ended_at", utcNow())
      .put("auth_user_id", prefs.getString(PREF_AUTH_USER_ID, "").orEmpty())
    File(recordingDir(id), ".ended").writeText(marker.toString())
  }

  private fun completeIfReady(id: String) {
    val dir = recordingDir(id)
    if (!dir.resolve(".ended").exists()) return
    if (dir.listFiles()?.any { it.name.endsWith(".meta.json") } == true) return
    rpc("complete_safety_recording_tum", JSONObject().put("p_recording_id", id))
    dir.resolve(".ended").delete()
    if (dir.listFiles().isNullOrEmpty()) dir.delete()
  }

  private fun rpc(name: String, body: JSONObject): JSONObject = SafetyUploadQueue.rpc(this, name, body)

  private fun quality(): String = prefs.getString(PREF_QUALITY_PRESET, "balanced") ?: "balanced"

  private fun chooseVideoSize(map: StreamConfigurationMap?): Size {
    val sizes = map?.getOutputSizes(MediaRecorder::class.java)?.toList().orEmpty()
    val targetW = if (quality() == "data_saver") 640 else 1280
    val targetH = if (quality() == "data_saver") 480 else 720
    return sizes.minByOrNull { kotlin.math.abs(it.width - targetW) + kotlin.math.abs(it.height - targetH) }
      ?: Size(targetW, targetH)
  }

  private fun recordingDir(id: String): File = File(filesDir, "tum-safety/$id").apply { mkdirs() }
  private fun segmentFile(id: String, sequence: Int, video: Boolean) = File(recordingDir(id), "segment_${sequence.toString().padStart(5, '0')}.${if (video) "mp4" else "m4a"}")
  private fun nextSequence(id: String): Int = recordingDir(id).listFiles()?.mapNotNull { Regex("segment_(\\d+)\\.").find(it.name)?.groupValues?.get(1)?.toIntOrNull() }?.maxOrNull()?.plus(1) ?: 0

  private fun updatePendingCount() { SafetyUploadQueue.updatePendingCount(this) }

  private fun calculateOrientationHint(characteristics: CameraCharacteristics, lensFacing: Int): Int {
    val sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90

    // IMPORTANTE: este código roda dentro de um Service. Em Android 12+ um Service
    // não é um Context visual e chamar Service.display / obter o display por ele
    // pode lançar: "Tried to obtain display from a Context not associated with one".
    // A Activity transparente captura a rotação enquanto ainda é um Context visual
    // e salva apenas os graus aqui para o serviço consumir em background.
    val deviceDegrees = prefs
      .getInt(PREF_DEVICE_ROTATION_DEGREES, 0)
      .let { if (it == 0 || it == 90 || it == 180 || it == 270) it else 0 }

    return if (lensFacing == CameraCharacteristics.LENS_FACING_FRONT) {
      (sensorOrientation + deviceDegrees) % 360
    } else {
      (sensorOrientation - deviceDegrees + 360) % 360
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    wakeLock = (getSystemService(PowerManager::class.java)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TUM:SafetyRecording").apply { setReferenceCounted(false); acquire() }
  }
  private fun releaseWakeLock() { runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }; wakeLock = null }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID, "Gravação de segurança", NotificationManager.IMPORTANCE_LOW).apply { description = "Mantém a gravação de segurança ativa durante a viagem." })
    }
  }

  private fun buildNotification(text: String): android.app.Notification {
    val stopIntent = Intent(this, SafetyRecordingService::class.java).apply { action = ACTION_STOP_RECORDING }
    val stopPending = PendingIntent.getService(this, STOP_REQUEST_ID, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("TUM · Segurança")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .addAction(0, "Parar", stopPending)
      .build()
  }
  private fun updateNotification(text: String) { getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text)) }

  private fun utcNow() = utcFromMillis(System.currentTimeMillis())
  private fun utcFromMillis(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))
}
