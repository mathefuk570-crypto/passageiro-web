-- TUM Safety Recording retention cleanup schedule.
-- Requires pg_cron, pg_net and the Vault secret tum_notification_cron_secret already used by TUM notifications.
do $do$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='tum-safety-recordings-cleanup' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;$do$;

select cron.schedule(
  'tum-safety-recordings-cleanup',
  '20 6 * * *',
  $cron$
    select net.http_post(
      url := 'https://wtfceelwjauydzilmfzy.supabase.co/functions/v1/cleanup-safety-recordings',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-tum-cron-secret',(
          select decrypted_secret from vault.decrypted_secrets
          where name='tum_notification_cron_secret'
          order by created_at desc limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $cron$
);
