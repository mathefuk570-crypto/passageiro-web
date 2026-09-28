package expo.modules.tumsafety

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class SafetyUploadWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
  override fun doWork(): Result {
    return try {
      val result = SafetyUploadQueue.flush(applicationContext)
      if (!result.queuedWork || !result.retryableForCurrentSession) Result.success() else Result.retry()
    } catch (_: Exception) {
      Result.retry()
    }
  }

  companion object {
    private const val UNIQUE_WORK = "tum-safety-pending-upload"

    fun schedule(context: Context) {
      val prefs = context.getSharedPreferences(SafetyRecordingService.PREFS_NAME, Context.MODE_PRIVATE)
      val networkType = if (prefs.getBoolean(SafetyRecordingService.PREF_MOBILE_UPLOAD_ENABLED, true)) {
        NetworkType.CONNECTED
      } else {
        NetworkType.UNMETERED
      }
      val request = OneTimeWorkRequestBuilder<SafetyUploadWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(networkType).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .build()
      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork(UNIQUE_WORK, ExistingWorkPolicy.REPLACE, request)
    }
  }
}
