package expo.modules.tumsafety

import android.os.Bundle
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

class SafetyGalleryUnlockActivity : FragmentActivity() {
  private val prefs by lazy { getSharedPreferences(SafetyRecordingService.PREFS_NAME, MODE_PRIVATE) }
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val executor = ContextCompat.getMainExecutor(this)
    val prompt = BiometricPrompt(this, executor, object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { finishWith(true) }
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { finishWith(false) }
    })
    val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    prompt.authenticate(BiometricPrompt.PromptInfo.Builder()
      .setTitle("Galeria de segurança")
      .setSubtitle("Confirme sua identidade para acessar as gravações")
      .setAllowedAuthenticators(authenticators)
      .build())
  }
  private fun finishWith(success: Boolean) {
    val now = System.currentTimeMillis()
    prefs.edit()
      .putBoolean(SafetyRecordingService.PREF_GALLERY_UNLOCK_SUCCESS, success)
      .putLong(SafetyRecordingService.PREF_GALLERY_UNLOCK_RESULT_AT, now)
      .apply {
        if (success) putLong(SafetyRecordingService.PREF_GALLERY_UNLOCKED_AT, now)
      }.apply()
    finish()
  }
}
