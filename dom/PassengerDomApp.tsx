'use dom';
import { useMemo } from 'react';
import './src/index.css';
import App from './src/App';
import {
  NativeActionsProvider,
  type PassengerPermissionStatus,
} from './src/lib/nativeActions';

export default function PassengerDomApp({
  runtimePlatform,
  nativeKeyboardHeight,
  nativeEssentialPermissionsStatus,
  registerNativePush,
  disableNativePush,
  setNativeTheme,
  shareText,
  shareNewsPost,
  getEssentialPermissionsStatus,
  requestEssentialPermissions,
  ensureLocationPermission,
  getCurrentNativeLocation,
  ensureMicrophonePermission,
  ensureNotificationPermission,
  ensureCameraPermission,
  openAppSettings,
  openNotificationSettings,
  getSafetyCompatibility,
  requestSafetyPermissions,
  configureSafetyRecordingContext,
  clearSafetyRecordingContext,
  startSafetyRecording,
  stopSafetyRecording,
  retrySafetyRecordingUploads,
  getSafetyRecordingStatus,
  authenticateSafetyGallery,
  nativeOpenUrl,
}: {
  dom?: import('expo/dom').DOMProps;
  runtimePlatform: string;
  nativeKeyboardHeight: number;
  nativeEssentialPermissionsStatus: PassengerPermissionStatus | null;
  registerNativePush: (accessToken: string, userId: string) => Promise<void>;
  disableNativePush: (accessToken: string, userId: string) => Promise<void>;
  setNativeTheme: (theme: 'dark' | 'light') => Promise<void>;
  shareText: (title: string, message: string) => Promise<boolean>;
  shareNewsPost: (title: string, message: string, imageUrl: string) => Promise<boolean>;
  getEssentialPermissionsStatus: () => Promise<PassengerPermissionStatus>;
  requestEssentialPermissions: () => Promise<PassengerPermissionStatus>;
  ensureLocationPermission: () => Promise<boolean>;
  getCurrentNativeLocation: () => Promise<import('./src/lib/nativeActions').NativeLocationResult | null>;
  ensureMicrophonePermission: () => Promise<boolean>;
  ensureNotificationPermission: () => Promise<boolean>;
  ensureCameraPermission: () => Promise<boolean>;
  openAppSettings: () => Promise<void>;
  openNotificationSettings: () => Promise<void>;
  getSafetyCompatibility: () => Promise<import('./src/lib/nativeActions').SafetyCompatibility>;
  requestSafetyPermissions: (captureMode: import('./src/lib/nativeActions').SafetyCaptureMode) => Promise<boolean>;
  configureSafetyRecordingContext: (input: import('./src/lib/nativeActions').SafetyConfigureInput) => Promise<boolean>;
  clearSafetyRecordingContext: () => Promise<boolean>;
  startSafetyRecording: () => Promise<boolean>;
  stopSafetyRecording: () => Promise<boolean>;
  retrySafetyRecordingUploads: () => Promise<boolean>;
  getSafetyRecordingStatus: () => Promise<import('./src/lib/nativeActions').SafetyRecordingNativeStatus>;
  authenticateSafetyGallery: () => Promise<boolean>;
  nativeOpenUrl: string;
}) {
  const actions = useMemo(
    () => ({
      registerNativePush,
      disableNativePush,
      setNativeTheme,
      shareText,
      shareNewsPost,
      getEssentialPermissionsStatus,
      requestEssentialPermissions,
      ensureLocationPermission,
      getCurrentNativeLocation,
      ensureMicrophonePermission,
      ensureNotificationPermission,
      ensureCameraPermission,
      openAppSettings,
      openNotificationSettings,
      getSafetyCompatibility,
      requestSafetyPermissions,
      configureSafetyRecordingContext,
      clearSafetyRecordingContext,
      startSafetyRecording,
      stopSafetyRecording,
      retrySafetyRecordingUploads,
      getSafetyRecordingStatus,
      authenticateSafetyGallery,
    }),
    [
      registerNativePush,
      disableNativePush,
      setNativeTheme,
      shareText,
      shareNewsPost,
      getEssentialPermissionsStatus,
      requestEssentialPermissions,
      ensureLocationPermission,
      getCurrentNativeLocation,
      ensureMicrophonePermission,
      ensureNotificationPermission,
      ensureCameraPermission,
      openAppSettings,
      openNotificationSettings,
      getSafetyCompatibility,
      requestSafetyPermissions,
      configureSafetyRecordingContext,
      clearSafetyRecordingContext,
      startSafetyRecording,
      stopSafetyRecording,
      retrySafetyRecordingUploads,
      getSafetyRecordingStatus,
      authenticateSafetyGallery,
    ],
  );

  return (
    <NativeActionsProvider actions={actions} openUrl={nativeOpenUrl}>
      <App
        runtimePlatform={runtimePlatform}
        nativeEssentialPermissionsStatus={nativeEssentialPermissionsStatus}
        nativeKeyboardHeight={nativeKeyboardHeight}
      />
    </NativeActionsProvider>
  );
}