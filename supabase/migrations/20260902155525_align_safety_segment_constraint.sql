-- Applied to production on 2026-09-02. Keep the table constraint aligned with the admin RPC/UI.
alter table public.safety_recording_settings
  drop constraint if exists safety_recording_settings_segment_target_mb_check;
alter table public.safety_recording_settings
  add constraint safety_recording_settings_segment_target_mb_check
  check (segment_target_mb between 4 and 20);
