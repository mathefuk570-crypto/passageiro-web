import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import {
  clearWebSafetyRideContext,
  configureWebSafetyRideContext,
  getWebSafetyCompatibility,
  getWebSafetyStatus,
  requestWebSafetyPermissions,
  retryWebSafetyUploads,
  startWebSafetyRecording,
  stopWebSafetyRecording,
} from './webRecorder';

export type SafetyCameraFacing = 'front' | 'back';
export type SafetyCaptureMode = 'video_audio' | 'audio_only';
export type SafetyQualityPreset = 'data_saver' | 'balanced' | 'clear';

export type SafetyCompatibility = {
  platform: string;
  cameraPermission: boolean;
  microphonePermission: boolean;
  videoSupported: boolean;
  audioSupported: boolean;
  frontCamera: boolean;
  backCamera: boolean;
  backgroundRecording: boolean;
  continuousSegments: boolean;
};

export type SafetyRecordingNativeStatus = {
  featureEnabled: boolean;
  rideId: string | null;
  recording: boolean;
  recordingId: string | null;
  startedAt: number | null;
  pendingSegments: number;
  lastError: string | null;
  cameraFacing: SafetyCameraFacing;
  captureMode: SafetyCaptureMode;
};

export type SafetyConfigureInput = {
  authUserId: string;
  rideId: string;
  cameraFacing: SafetyCameraFacing;
  captureMode: SafetyCaptureMode;
  qualityPreset: SafetyQualityPreset;
  segmentTargetMb: number;
  mobileUploadEnabled: boolean;
  featureEnabled: boolean;
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
  deviceModel?: string | null;
  appVersion?: string | null;
};

type NativeModule = {
  getCompatibility(): Promise<SafetyCompatibility>;
  configureRideContext(input: SafetyConfigureInput): Promise<boolean>;
  clearRideContext(): Promise<boolean>;
  startRecording(): Promise<boolean>;
  stopRecording(): Promise<boolean>;
  retryPendingUploads(): Promise<boolean>;
  getStatus(): Promise<SafetyRecordingNativeStatus>;
  beginGalleryUnlock(): Promise<boolean>;
  getGalleryUnlockState(): Promise<{ unlocked: boolean; success: boolean; resultAt: number }>;
  lockGallery(): Promise<boolean>;
  openCameraPreview?(cameraFacing: SafetyCameraFacing): Promise<boolean>;
};

let native: NativeModule | null = null;
if (Platform.OS !== 'web') {
  try { native = requireNativeModule<NativeModule>('TumSafety'); } catch { native = null; }
}

const emptyCompatibility: SafetyCompatibility = {
  platform: Platform.OS,
  cameraPermission: false,
  microphonePermission: false,
  videoSupported: false,
  audioSupported: false,
  frontCamera: false,
  backCamera: false,
  backgroundRecording: false,
  continuousSegments: false,
};

export async function getSafetyCompatibility() { return Platform.OS === 'web' ? getWebSafetyCompatibility() : native ? native.getCompatibility() : emptyCompatibility; }
export async function configureSafetyRideContext(input: SafetyConfigureInput) { return Platform.OS === 'web' ? configureWebSafetyRideContext(input) : native ? native.configureRideContext(input) : false; }
export async function clearSafetyRideContext() { return Platform.OS === 'web' ? clearWebSafetyRideContext() : native ? native.clearRideContext() : false; }
export async function startSafetyRecording() { return Platform.OS === 'web' ? startWebSafetyRecording() : native ? native.startRecording() : false; }
export async function stopSafetyRecording() { return Platform.OS === 'web' ? stopWebSafetyRecording() : native ? native.stopRecording() : false; }
export async function retrySafetyUploads() { return Platform.OS === 'web' ? retryWebSafetyUploads() : native ? native.retryPendingUploads() : false; }
export async function getSafetyNativeStatus(): Promise<SafetyRecordingNativeStatus> {
  if (Platform.OS === 'web') return getWebSafetyStatus();
  return native ? native.getStatus() : { featureEnabled: false, rideId: null, recording: false, recordingId: null, startedAt: null, pendingSegments: 0, lastError: 'Módulo nativo indisponível', cameraFacing: 'front', captureMode: 'video_audio' };
}
export async function requestSafetyPermissions(captureMode: SafetyCaptureMode): Promise<boolean> {
  return Platform.OS === 'web' ? requestWebSafetyPermissions(captureMode) : false;
}

export async function authenticateSafetyGallery(): Promise<boolean> {
  if (!native) return Platform.OS === 'web';
  const started = await native.beginGalleryUnlock();
  if (!started) return false;
  const timeout = Date.now() + 90_000;
  while (Date.now() < timeout) {
    const state = await native.getGalleryUnlockState();
    if (state.success && state.unlocked) return true;
    if (state.resultAt > 0 && !state.success) return false;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return false;
}
export async function lockSafetyGallery() { return native ? native.lockGallery() : false; }
export async function openSafetyCameraPreview(cameraFacing: SafetyCameraFacing) { return native?.openCameraPreview ? native.openCameraPreview(cameraFacing) : false; }
