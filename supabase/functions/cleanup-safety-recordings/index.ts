import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-tum-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Servidor incompleto." }, 500);
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: expectedSecret, error: secretError } = await service.rpc("get_tum_notification_cron_secret");
  if (secretError || !expectedSecret || req.headers.get("x-tum-cron-secret") !== expectedSecret) return json({ error: "Acesso negado." }, 403);

  const now = new Date().toISOString();
  const { data: recordings, error: recordingsError } = await service.from("safety_recordings").select("id,auth_user_id").is("preserved_at", null).neq("status", "deleted").lte("expires_at", now).order("expires_at", { ascending: true }).limit(50);
  if (recordingsError) return json({ error: recordingsError.message }, 500);
  let cleaned = 0; let failed = 0;
  for (const recording of recordings ?? []) {
    try {
      const { data: segments, error: segmentsError } = await service.from("safety_recording_segments").select("storage_path").eq("recording_id", recording.id);
      if (segmentsError) throw segmentsError;
      const paths = (segments ?? []).map((row) => row.storage_path).filter(Boolean);
      if (paths.length) { const { error } = await service.storage.from("safety-recordings").remove(paths); if (error) throw error; }
      const { error: deleteSegmentsError } = await service.from("safety_recording_segments").delete().eq("recording_id", recording.id); if (deleteSegmentsError) throw deleteSegmentsError;
      const { error: updateError } = await service.from("safety_recordings").update({ status: "deleted", total_bytes: 0, segment_count: 0, updated_at: new Date().toISOString() }).eq("id", recording.id).is("preserved_at", null); if (updateError) throw updateError;
      await service.from("safety_recording_audit").insert({ recording_id: recording.id, actor_auth_user_id: "00000000-0000-0000-0000-000000000000", actor_type: "system", action: "cleanup", metadata: { reason: "retention_expired" } });
      cleaned += 1;
    } catch (error) { console.error("Falha ao limpar gravação", recording.id, error); failed += 1; }
  }
  return json({ success: true, checked: recordings?.length ?? 0, cleaned, failed });
});
