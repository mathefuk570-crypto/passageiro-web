-- Allow delayed/offline segments to resume after the recording has already been stopped.
drop policy if exists safety_recordings_storage_insert_tum on storage.objects;
create policy safety_recordings_storage_insert_tum
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'safety-recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.safety_recordings r
    where r.id::text = (storage.foldername(name))[2]
      and r.auth_user_id = (select auth.uid())
      and r.status in ('recording','uploading','partial','failed')
  )
);
