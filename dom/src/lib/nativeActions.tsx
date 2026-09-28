import { createContext, useContext, type ReactNode } from 'react';

export type NativePermissionState =
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable';



export type SafetyCameraFacing = 'front' | 'back';
export type SafetyCaptureMode = 'video_audio' | 'audio_only';
export type SafetyQualityPreset = 'data_saver' | 'balanced' | 'clear';
export type SafetyCompatibility = { platform:string;cameraPermission:boolean;microphonePermission:boolean;videoSupported:boolean;audioSupported:boolean;frontCamera:boolean;backCamera:boolean;backgroundRecording:boolean;continuousSegments:boolean; };
export type SafetyRecordingNativeStatus = { featureEnabled:boolean;rideId:string|null;recording:boolean;recordingId:string|null;startedAt:number|null;pendingSegments:number;lastError:string|null;cameraFacing:SafetyCameraFacing;captureMode:SafetyCaptureMode; };
export type SafetyConfigureInput = {authUserId:string;rideId:string;cameraFacing:SafetyCameraFacing;captureMode:SafetyCaptureMode;qualityPreset:SafetyQualityPreset;segmentTargetMb:number;mobileUploadEnabled:boolean;featureEnabled:boolean;supabaseUrl:string;anonKey:string;accessToken:string;refreshToken:string;};

export type NativeLocationResult = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
};

export type PassengerPermissionStatus = {
  location: NativePermissionState;
  microphone: NativePermissionState;
  notifications: NativePermissionState;
  camera: NativePermissionState;
  allGranted: boolean;
};

export interface TumNativeActions {
  registerNativePush: (accessToken: string, userId: string) => Promise<void>;
  disableNativePush: (accessToken: string, userId: string) => Promise<void>;
  setNativeTheme?: (theme: 'dark' | 'light') => Promise<void>;
  shareText?: (title: string, message: string) => Promise<boolean>;
  shareNewsPost?: (title: string, message: string, imageUrl: string) => Promise<boolean>;
  getEssentialPermissionsStatus?: () => Promise<PassengerPermissionStatus>;
  requestEssentialPermissions?: () => Promise<PassengerPermissionStatus>;
  ensureLocationPermission?: () => Promise<boolean>;
  getCurrentNativeLocation?: () => Promise<NativeLocationResult | null>;
  ensureMicrophonePermission?: () => Promise<boolean>;
  ensureNotificationPermission?: () => Promise<boolean>;
  ensureCameraPermission?: () => Promise<boolean>;
  openAppSettings?: () => Promise<void>;
  openNotificationSettings?: () => Promise<void>;
  getSafetyCompatibility?: () => Promise<SafetyCompatibility>;
  requestSafetyPermissions?: (captureMode: SafetyCaptureMode) => Promise<boolean>;
  configureSafetyRecordingContext?: (input: SafetyConfigureInput) => Promise<boolean>;
  clearSafetyRecordingContext?: () => Promise<boolean>;
  startSafetyRecording?: () => Promise<boolean>;
  stopSafetyRecording?: () => Promise<boolean>;
  retrySafetyRecordingUploads?: () => Promise<boolean>;
  getSafetyRecordingStatus?: () => Promise<SafetyRecordingNativeStatus>;
  authenticateSafetyGallery?: () => Promise<boolean>;
}

const NativeActionsContext = createContext<TumNativeActions | null>(null);
const NativeOpenUrlContext = createContext('');

export function NativeActionsProvider({
  actions,
  openUrl = '',
  children,
}: {
  actions: TumNativeActions | null;
  openUrl?: string;
  children: ReactNode;
}) {
  return (
    <NativeActionsContext.Provider value={actions}>
      <NativeOpenUrlContext.Provider value={openUrl}>
        {children}
      </NativeOpenUrlContext.Provider>
    </NativeActionsContext.Provider>
  );
}

export function useNativeActions(): TumNativeActions | null {
  return useContext(NativeActionsContext);
}

export function useNativeOpenUrl(): string {
  return useContext(NativeOpenUrlContext);
}