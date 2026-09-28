package expo.modules.tumsafety

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Keeps Supabase session tokens out of plain SharedPreferences. */
object SafetySecretStore {
  private const val KEY_ALIAS = "tum_safety_session_v1"
  private const val PREFIX = "secure_"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  private fun prefs(context: Context) = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)

  @Synchronized
  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  fun put(context: Context, name: String, value: String) {
    if (value.isBlank()) {
      remove(context, name)
      return
    }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val payload = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP)
    prefs(context).edit().putString(PREFIX + name, payload).remove(name).apply()
  }

  fun get(context: Context, name: String): String {
    val preferences = prefs(context)
    val payload = preferences.getString(PREFIX + name, null)
    if (!payload.isNullOrBlank()) {
      return runCatching {
        val parts = payload.split('.', limit = 2)
        require(parts.size == 2)
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(encrypted), Charsets.UTF_8)
      }.getOrElse { "" }
    }

    // One-time migration from older builds that stored tokens in plaintext.
    val legacy = preferences.getString(name, "").orEmpty()
    if (legacy.isNotBlank()) {
      runCatching { put(context, name, legacy) }
    }
    return legacy
  }

  fun remove(context: Context, name: String) {
    prefs(context).edit().remove(PREFIX + name).remove(name).apply()
  }
}
