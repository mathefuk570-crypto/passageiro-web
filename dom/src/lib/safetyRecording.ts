import { supabase } from './supabase';
import type { SafetyCameraFacing, SafetyCaptureMode, SafetyQualityPreset, TumNativeActions } from './nativeActions';

const SUPABASE_URL = 'https://wtfceelwjauydzilmfzy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZmNlZWx3amF1eWR6aWxtZnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMzc4NjgsImV4cCI6MjA5OTkxMzg2OH0.80T5FnZWlYHSaIQqxnMk9Ug00DVxFMzQR9FEvtCv-CE';

export type SafetyRecordingState = {
  enabled: boolean; camera_facing: SafetyCameraFacing; capture_mode: SafetyCaptureMode; intro_seen: boolean;
  retention_days: number; driver_enabled: boolean; passenger_enabled: boolean; mobile_upload_enabled: boolean;
  quality_preset: SafetyQualityPreset; segment_target_mb: number;
};
export type SafetyRecordingRow = { id:string;ride_id:string;user_type:'driver'|'passenger';display_name:string|null;camera_facing:SafetyCameraFacing;capture_mode:SafetyCaptureMode;has_video?:boolean;has_audio?:boolean;status:string;started_at:string;ended_at:string|null;duration_seconds:number;total_bytes:number;segment_count:number;expires_at:string|null;preserved_at:string|null;preserve_reason:string|null;origin_address:string|null;destination_address:string|null; };
export type SafetySegmentRow = { id:string;recording_id:string;sequence:number;storage_path:string;mime_type:string;byte_size:number;duration_ms:number; };

export async function loadSafetyRecordingState():Promise<SafetyRecordingState>{ const {data,error}=await supabase.rpc('get_my_safety_recording_state_tum'); if(error)throw error; return data as SafetyRecordingState; }
export async function saveSafetyRecordingState(patch:Partial<Pick<SafetyRecordingState,'enabled'|'camera_facing'|'capture_mode'|'intro_seen'>>){ const current=await loadSafetyRecordingState(); const next={...current,...patch}; const {data,error}=await supabase.rpc('update_my_safety_recording_preferences_tum',{p_enabled:next.enabled,p_camera_facing:next.camera_facing,p_capture_mode:next.capture_mode,p_intro_seen:next.intro_seen}); if(error)throw error; return {...next,...(data as Partial<SafetyRecordingState>)}; }
export async function preparePassengerSafetyRecording(rideId:string,state:SafetyRecordingState,native:TumNativeActions|null){ if(!native?.configureSafetyRecordingContext)return; const {data}=await supabase.auth.getSession(); const session=data.session; if(!session||!state.enabled||!state.passenger_enabled){ await native.clearSafetyRecordingContext?.(); return; } await native.configureSafetyRecordingContext({authUserId:session.user.id,rideId,cameraFacing:state.camera_facing,captureMode:state.capture_mode,qualityPreset:state.quality_preset,segmentTargetMb:state.segment_target_mb,mobileUploadEnabled:state.mobile_upload_enabled,featureEnabled:true,supabaseUrl:SUPABASE_URL,anonKey:SUPABASE_ANON_KEY,accessToken:session.access_token,refreshToken:session.refresh_token}); }
export async function listMySafetyRecordings(){ const {data,error}=await supabase.from('safety_recordings').select('id,ride_id,user_type,display_name,camera_facing,capture_mode,has_video,has_audio,status,started_at,ended_at,duration_seconds,total_bytes,segment_count,expires_at,preserved_at,preserve_reason,origin_address,destination_address').neq('status','deleted').order('started_at',{ascending:false}); if(error)throw error; return (data??[]) as SafetyRecordingRow[]; }
export async function listSafetySegments(id:string){ const {data,error}=await supabase.from('safety_recording_segments').select('*').eq('recording_id',id).order('sequence'); if(error)throw error; return (data??[]) as SafetySegmentRow[]; }
export async function createSafetySegmentSignedUrl(path:string){ const {data,error}=await supabase.storage.from('safety-recordings').createSignedUrl(path,3600); if(error)throw error; return data.signedUrl; }
export async function preserveSafetyRecording(id:string,preserve:boolean){ const {error}=await supabase.rpc('preserve_my_safety_recording_tum',{p_recording_id:id,p_preserve:preserve,p_reason:preserve?'Protegida pelo usuário':null}); if(error)throw error; }
export async function deleteSafetyRecording(row:SafetyRecordingRow){ if(row.preserved_at)throw new Error('Gravação preservada não pode ser excluída.'); const segs=await listSafetySegments(row.id); if(segs.length){ const {error}=await supabase.storage.from('safety-recordings').remove(segs.map(s=>s.storage_path)); if(error)throw error; } const {error}=await supabase.rpc('mark_my_safety_recording_deleted_tum',{p_recording_id:row.id}); if(error)throw error; }


export async function finishPassengerSafetyRecording(native:TumNativeActions|null){
  try {
    const status=await native?.getSafetyRecordingStatus?.();
    if(status?.recording) await native?.stopSafetyRecording?.();
  } catch {}
  try { await native?.clearSafetyRecordingContext?.(); } catch {}
  try { await native?.retrySafetyRecordingUploads?.(); } catch {}
}
