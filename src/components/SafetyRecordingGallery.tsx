import { useEffect, useState } from 'react';
import { ArrowLeft, LockKeyhole, Play, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  createSafetySegmentSignedUrl,
  deleteSafetyRecording,
  listMySafetyRecordings,
  listSafetySegments,
  preserveSafetyRecording,
  type SafetyRecordingRow,
} from '../lib/safetyRecording';
import { useNativeActions } from '../lib/nativeActions';
import AlertModal from './AlertModal';

export default function SafetyRecordingGallery({ open, onClose }: { open: boolean; onClose: () => void }) {
  const native = useNativeActions();
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SafetyRecordingRow[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [playIndex, setPlayIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SafetyRecordingRow | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await listMySafetyRecordings());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setUnlocked(false);
      setUrls([]);
      setPlayIndex(0);
      setDeleteTarget(null);
      setNotice(null);
      return;
    }

    void (async () => {
      const ok = await native?.authenticateSafetyGallery?.();
      setUnlocked(!!ok);
      if (ok) await refresh();
    })();
  }, [open, native]);

  if (!open) return null;

  async function play(row: SafetyRecordingRow) {
    const segments = await listSafetySegments(row.id);
    if (!segments.length) {
      setNotice({
        title: 'Gravação sendo enviada',
        message: 'Os trechos ainda estão sendo enviados. Tente novamente em alguns instantes.',
      });
      return;
    }

    setUrls(await Promise.all(segments.map((segment) => createSafetySegmentSignedUrl(segment.storage_path))));
    setPlayIndex(0);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteSafetyRecording(target);
      await refresh();
    } catch (error) {
      setNotice({
        title: 'Não foi possível excluir',
        message: error instanceof Error ? error.message : 'Tente novamente em alguns instantes.',
      });
    }
  }

  return (
    <div className="fixed inset-0 z-[190] flex flex-col bg-tum-dark">
      <div className="flex items-center gap-3 border-b border-white/10 bg-tum-dark-2 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white">
          <ArrowLeft size={19} />
        </button>
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-tum-yellow">Segurança</p>
          <h2 className="font-black text-white">Minha galeria</h2>
        </div>
        <button type="button" onClick={onClose} className="text-white/50" aria-label="Fechar galeria">
          <X />
        </button>
      </div>

      {!unlocked ? (
        <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
          <LockKeyhole size={42} className="text-tum-yellow" />
          <h3 className="mt-3 font-black text-white">Galeria protegida</h3>
          <p className="mt-2 text-sm text-white/45">Confirme a biometria ou o bloqueio do aparelho para acessar.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {loading ? (
            <p className="text-center text-sm text-white/40">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="text-center text-sm text-white/40">Nenhuma gravação disponível.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded-[22px] border border-white/10 bg-tum-dark-2 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-1 shrink-0 text-tum-yellow" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-white">{new Date(row.started_at).toLocaleString('pt-BR')}</p>
                      <p className="mt-1 text-xs leading-5 text-white/45">{row.origin_address || 'Embarque'} → {row.destination_address || 'Destino'}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] font-bold text-white/45">
                    {row.capture_mode === 'audio_only' ? 'Somente áudio' : row.camera_facing === 'front' ? 'Vídeo frontal + áudio' : 'Vídeo traseiro + áudio'} · {row.segment_count} trecho(s) · {(Number(row.total_bytes || 0) / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => void play(row)} className="flex items-center justify-center gap-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-white">
                      <Play size={15} /> Abrir
                    </button>
                    <button type="button" onClick={() => void preserveSafetyRecording(row.id, !row.preserved_at).then(refresh)} className="flex items-center justify-center gap-1 rounded-xl border border-white/10 py-2.5 text-xs font-bold text-white">
                      <ShieldCheck size={15} className={row.preserved_at ? 'text-emerald-300' : ''} />
                      {row.preserved_at ? 'Protegida' : 'Preservar'}
                    </button>
                    <button type="button" disabled={!!row.preserved_at} onClick={() => setDeleteTarget(row)} className="flex items-center justify-center rounded-xl border border-red-500/20 py-2.5 text-red-300 disabled:opacity-30" aria-label="Excluir gravação">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {urls.length > 0 && (
        <div className="fixed inset-0 z-[230] flex flex-col bg-black">
          <button type="button" onClick={() => { setUrls([]); setPlayIndex(0); }} className="h-14 font-black text-white">FECHAR</button>
          <video
            src={urls[playIndex]}
            className="min-h-0 flex-1 object-contain"
            controls
            autoPlay
            playsInline
            onEnded={() => { if (playIndex + 1 < urls.length) setPlayIndex(playIndex + 1); }}
          />
          <div className="p-3 text-center text-xs font-bold text-white/45">Trecho {playIndex + 1} de {urls.length}</div>
        </div>
      )}

      <AlertModal
        open={Boolean(deleteTarget)}
        title="Excluir gravação?"
        message="Essa gravação será removida da sua galeria. Gravações preservadas não podem ser excluídas por aqui."
        variant="warning"
        secondaryLabel="Cancelar"
        actionLabel="Excluir"
        onSecondary={() => setDeleteTarget(null)}
        onAction={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <AlertModal
        open={Boolean(notice)}
        title={notice?.title}
        message={notice?.message ?? ''}
        variant="info"
        onClose={() => setNotice(null)}
      />
    </div>
  );
}
