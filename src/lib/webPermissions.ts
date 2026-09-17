import type { NativePermissionState, PassengerPermissionStatus } from './nativeActions';
import { getWebPushPermission, requestAndRegisterWebPush } from './pushNotifications';
async function permission(name: string): Promise<NativePermissionState> {
  try { const result = await navigator.permissions.query({ name: name as PermissionName });
    return result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'blocked' : 'denied';
  } catch { return 'denied'; }
}
export async function webPermissionStatus(): Promise<PassengerPermissionStatus> {
  const [location, camera, microphone] = await Promise.all([
    navigator.geolocation ? permission('geolocation') : 'unavailable' as const,
    typeof navigator.mediaDevices?.getUserMedia === 'function' ? permission('camera') : 'unavailable' as const,
    typeof navigator.mediaDevices?.getUserMedia === 'function' ? permission('microphone') : 'unavailable' as const,
  ]);
  const push = getWebPushPermission();
  const notifications = push === 'unsupported' ? 'unavailable' : push === 'denied' ? 'blocked' : push === 'granted' ? 'granted' : 'denied';
  return { location, camera, microphone, notifications, allGranted: location === 'granted' && notifications === 'granted' };
}
export async function requestWebLocation(): Promise<boolean> {
  if (!navigator.geolocation) return false;
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), {enableHighAccuracy:true,timeout:12000,maximumAge:30000}));
}
async function requestMedia(kind: 'audio' | 'video') {
  try { const stream = await navigator.mediaDevices.getUserMedia({[kind]:true}); stream.getTracks().forEach(t => t.stop()); return true; }
  catch { return false; }
}
export const webPermissionActions = {
  getEssentialPermissionsStatus: webPermissionStatus,
  ensureLocationPermission: requestWebLocation,
  ensureNotificationPermission: async () => (await requestAndRegisterWebPush()).registered,
  ensureCameraPermission: () => requestMedia('video'),
  ensureMicrophonePermission: () => requestMedia('audio'),
  openAppSettings: async () => { window.alert('Abra as permissões deste site no menu do navegador. No iPhone, consulte também Ajustes > Apps > Safari.'); },
  openNotificationSettings: async () => { window.alert('Revise as notificações nas permissões do navegador. No iPhone, adicione o TUM à Tela de Início, abra pelo ícone e toque em Ativar notificações.'); },
};
