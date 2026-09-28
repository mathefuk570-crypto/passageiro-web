import ExpoModulesCore
import AVFoundation

public class TumSafetyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TumSafety")

    AsyncFunction("getCompatibility") { () -> [String: Any] in
      let cameraAuthorized = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
      let microphoneAuthorized = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
      // TUM requires capture to survive the app going to the background (for example
      // when Driver opens Maps/Waze). iOS does not guarantee background camera capture,
      // so the feature stays unavailable instead of offering a misleading partial mode.
      return [
        "platform":"ios",
        "cameraPermission":cameraAuthorized,
        "microphonePermission":microphoneAuthorized,
        "videoSupported":false,
        "audioSupported":false,
        "frontCamera":false,
        "backCamera":false,
        "backgroundRecording":false,
        "continuousSegments":false
      ]
    }
    AsyncFunction("configureRideContext") { (_: [String: Any]) -> Bool in false }
    AsyncFunction("clearRideContext") { () -> Bool in true }
    AsyncFunction("startRecording") { () -> Bool in false }
    AsyncFunction("stopRecording") { () -> Bool in false }
    AsyncFunction("retryPendingUploads") { () -> Bool in false }
    AsyncFunction("getStatus") { () -> [String: Any] in
      return [
        "featureEnabled":false,
        "rideId":NSNull(),
        "recording":false,
        "recordingId":NSNull(),
        "startedAt":NSNull(),
        "pendingSegments":0,
        "lastError":"REC contínuo indisponível no iOS: a câmera não pode permanecer capturando quando o app vai para segundo plano.",
        "cameraFacing":"front",
        "captureMode":"video_audio"
      ]
    }
    AsyncFunction("beginGalleryUnlock") { () -> Bool in false }
    AsyncFunction("getGalleryUnlockState") { () -> [String: Any] in ["unlocked":false,"success":false,"resultAt":0] }
    AsyncFunction("lockGallery") { () -> Bool in true }
    AsyncFunction("openCameraPreview") { (_: String) -> Bool in false }
  }
}
