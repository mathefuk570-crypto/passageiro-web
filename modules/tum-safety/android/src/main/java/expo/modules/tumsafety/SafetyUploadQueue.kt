package expo.modules.tumsafety

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONObject
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object SafetyUploadQueue {
  data class FlushResult(
    val pendingCount: Int,
    val queuedWork: Boolean,
    val retryableForCurrentSession: Boolean,
  )

  @Synchronized
  fun flush(context: Context): FlushResult {
    if (!canUploadNow(context)) return queueState(context)

    val root = File(context.filesDir, "tum-safety")
    if (!root.exists()) return queueState(context)

    root.listFiles()?.filter { it.isDirectory }?.forEach { dir ->
      dir.listFiles()
        ?.filter { it.name.endsWith(".meta.json") }
        ?.sortedBy { it.name }
        ?.forEach { metaFile -> runCatching { uploadMeta(context, metaFile) } }

      if (dir.resolve(".ended").exists() && dir.listFiles()?.none { it.name.endsWith(".meta.json") } == true) {
        runCatching { completeIfReady(context, dir.name) }
      }
    }
    return queueState(context)
  }

  fun hasQueuedWork(context: Context): Boolean {
    val root = File(context.filesDir, "tum-safety")
    if (!root.exists()) return false
    return root.walkTopDown().any { file ->
      file.isFile && (file.name.endsWith(".meta.json") || file.name == ".ended")
    }
  }

  fun hasQueuedWorkForCurrentSession(context: Context): Boolean {
    val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
    val currentAuth = prefs.getString(SafetyRecordingService.PREF_AUTH_USER_ID, "").orEmpty()
    if (currentAuth.isBlank() || SafetySecretStore.get(context, SafetyRecordingService.PREF_ACCESS_TOKEN).isBlank()) return false
    val root = File(context.filesDir, "tum-safety")
    if (!root.exists()) return false

    return root.walkTopDown().any { file ->
      if (!file.isFile) return@any false
      when {
        file.name.endsWith(".meta.json") -> runCatching {
          val meta = JSONObject(file.readText())
          val owner = meta.optString("auth_user_id", currentAuth).ifBlank { currentAuth }
          owner == currentAuth
        }.getOrDefault(false)
        file.name == ".ended" -> endedOwner(file, currentAuth) == currentAuth
        else -> false
      }
    }
  }

  fun updatePendingCount(context: Context): Int {
    val root = File(context.filesDir, "tum-safety")
    val count = if (root.exists()) root.walkTopDown().count { it.isFile && it.name.endsWith(".meta.json") } else 0
    context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
      .edit().putInt(SafetyRecordingService.PREF_PENDING_SEGMENTS, count).apply()
    return count
  }

  private fun queueState(context: Context): FlushResult {
    val pending = updatePendingCount(context)
    return FlushResult(
      pendingCount = pending,
      queuedWork = hasQueuedWork(context),
      retryableForCurrentSession = hasQueuedWorkForCurrentSession(context),
    )
  }

  private fun endedOwner(file: File, fallback: String): String = runCatching {
    JSONObject(file.readText()).optString("auth_user_id", fallback).ifBlank { fallback }
  }.getOrDefault(fallback)

  private fun uploadMeta(context: Context, metaFile: File) {
    val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
    val meta = JSONObject(metaFile.readText())
    val file = File(meta.getString("local_path"))
    if (!file.exists() || file.length() <= 0) {
      metaFile.delete()
      return
    }
    val id = meta.getString("recording_id")
    val sequence = meta.getInt("sequence")
    val sessionAuth = prefs.getString(SafetyRecordingService.PREF_AUTH_USER_ID, "").orEmpty()
    val auth = meta.optString("auth_user_id", sessionAuth).ifBlank { sessionAuth }
    if (auth.isBlank()) error("Sessão ausente para upload.")
    if (sessionAuth.isNotBlank() && auth != sessionAuth) error("Este trecho pertence a outra conta do TUM.")
    val ext = if (meta.getString("mime_type").startsWith("video/")) "mp4" else "m4a"
    val storagePath = "$auth/$id/${sequence.toString().padStart(5, '0')}.$ext"
    uploadStorage(context, storagePath, file, meta.getString("mime_type"))
    rpc(context, "register_safety_recording_segment_tum", JSONObject()
      .put("p_recording_id", id)
      .put("p_sequence", sequence)
      .put("p_storage_path", storagePath)
      .put("p_mime_type", meta.getString("mime_type"))
      .put("p_byte_size", file.length())
      .put("p_duration_ms", meta.optInt("duration_ms", 0))
      .put("p_segment_started_at", meta.optString("segment_started_at", null))
      .put("p_segment_ended_at", meta.optString("segment_ended_at", null)))
    metaFile.delete()
    file.delete()
  }

  private fun completeIfReady(context: Context, id: String) {
    val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
    val dir = File(context.filesDir, "tum-safety/$id")
    val ended = dir.resolve(".ended")
    if (!ended.exists()) return
    if (dir.listFiles()?.any { it.name.endsWith(".meta.json") } == true) return
    val currentAuth = prefs.getString(SafetyRecordingService.PREF_AUTH_USER_ID, "").orEmpty()
    val owner = endedOwner(ended, currentAuth)
    if (owner.isNotBlank() && currentAuth.isNotBlank() && owner != currentAuth) return
    rpc(context, "complete_safety_recording_tum", JSONObject().put("p_recording_id", id))
    ended.delete()
    if (dir.listFiles().isNullOrEmpty()) dir.delete()
  }

  private fun canUploadNow(context: Context): Boolean {
    val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
    val cm = context.getSystemService(ConnectivityManager::class.java)
    val network = cm.activeNetwork ?: return false
    val caps = cm.getNetworkCapabilities(network) ?: return false
    if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
      !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return false
    if (prefs.getBoolean(SafetyRecordingService.PREF_MOBILE_UPLOAD_ENABLED, true)) return true
    return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  }

  private fun uploadStorage(context: Context, path: String, file: File, mime: String) {
    fun send(allowRefresh: Boolean): Int {
      val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
      val base = prefs.getString(SafetyRecordingService.PREF_SUPABASE_URL, "").orEmpty().trimEnd('/')
      val anon = prefs.getString(SafetyRecordingService.PREF_ANON_KEY, "").orEmpty()
      val token = SafetySecretStore.get(context, SafetyRecordingService.PREF_ACCESS_TOKEN)
      if (base.isBlank() || anon.isBlank() || token.isBlank()) error("Sessão do TUM incompleta.")
      val encoded = path.split('/').joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
      val con = URL("$base/storage/v1/object/safety-recordings/$encoded").openConnection() as HttpURLConnection
      try {
        con.requestMethod = "POST"
        con.connectTimeout = 15_000
        con.readTimeout = 30_000
        con.doOutput = true
        con.setRequestProperty("apikey", anon)
        con.setRequestProperty("Authorization", "Bearer $token")
        con.setRequestProperty("Content-Type", mime)
        con.setRequestProperty("x-upsert", "false")
        file.inputStream().use { input -> con.outputStream.use { output -> input.copyTo(output, 64 * 1024) } }
        val code = con.responseCode
        if (code == 401 && allowRefresh && refreshSession(context)) return send(false)
        if (code !in 200..299 && code != HttpURLConnection.HTTP_CONFLICT) error("Falha no upload ($code): ${readResponse(con)}")
        return code
      } finally { con.disconnect() }
    }
    send(true)
  }

  fun rpc(context: Context, name: String, body: JSONObject): JSONObject {
    fun send(allowRefresh: Boolean): JSONObject {
      val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
      val base = prefs.getString(SafetyRecordingService.PREF_SUPABASE_URL, "").orEmpty().trimEnd('/')
      val anon = prefs.getString(SafetyRecordingService.PREF_ANON_KEY, "").orEmpty()
      val token = SafetySecretStore.get(context, SafetyRecordingService.PREF_ACCESS_TOKEN)
      if (base.isBlank() || anon.isBlank() || token.isBlank()) error("Sessão do TUM incompleta.")
      val con = URL("$base/rest/v1/rpc/$name").openConnection() as HttpURLConnection
      try {
        con.requestMethod = "POST"
        con.connectTimeout = 10_000
        con.readTimeout = 15_000
        con.doOutput = true
        con.setRequestProperty("apikey", anon)
        con.setRequestProperty("Authorization", "Bearer $token")
        con.setRequestProperty("Content-Type", "application/json")
        con.setRequestProperty("Accept", "application/json")
        OutputStreamWriter(con.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
        val code = con.responseCode
        if (code == 401 && allowRefresh && refreshSession(context)) return send(false)
        val response = readResponse(con)
        if (code !in 200..299) error(response.ifBlank { "Falha no servidor ($code)." })
        return if (response.isBlank() || response == "null") JSONObject() else JSONObject(response)
      } finally { con.disconnect() }
    }
    return send(true)
  }

  private fun refreshSession(context: Context): Boolean {
    val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
    val refresh = SafetySecretStore.get(context, SafetyRecordingService.PREF_REFRESH_TOKEN)
    val base = prefs.getString(SafetyRecordingService.PREF_SUPABASE_URL, "").orEmpty().trimEnd('/')
    val anon = prefs.getString(SafetyRecordingService.PREF_ANON_KEY, "").orEmpty()
    if (refresh.isBlank() || base.isBlank() || anon.isBlank()) return false
    return runCatching {
      val con = URL("$base/auth/v1/token?grant_type=refresh_token").openConnection() as HttpURLConnection
      try {
        con.requestMethod = "POST"
        con.connectTimeout = 10_000
        con.readTimeout = 10_000
        con.doOutput = true
        con.setRequestProperty("apikey", anon)
        con.setRequestProperty("Content-Type", "application/json")
        OutputStreamWriter(con.outputStream, Charsets.UTF_8).use { it.write(JSONObject().put("refresh_token", refresh).toString()) }
        if (con.responseCode !in 200..299) return@runCatching false
        val json = JSONObject(readResponse(con))
        val access = json.optString("access_token")
        if (access.isBlank()) return@runCatching false
        SafetySecretStore.put(context, SafetyRecordingService.PREF_ACCESS_TOKEN, access)
        SafetySecretStore.put(context, SafetyRecordingService.PREF_REFRESH_TOKEN, json.optString("refresh_token", refresh))
        true
      } finally { con.disconnect() }
    }.getOrDefault(false)
  }

  private fun readResponse(con: HttpURLConnection): String {
    val stream = if (con.responseCode in 200..299) con.inputStream else con.errorStream
    return stream?.bufferedReader()?.use { it.readText() }.orEmpty()
  }
}
