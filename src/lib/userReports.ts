import { supabase } from "./supabase";

export type UserReportReason =
  | 'aggressive_behavior'
  | 'harassment'
  | 'vehicle_damage_dirty'
  | 'different_person'
  | 'fraud_nonpayment'
  | 'illegal_or_risk'
  | 'other';

export const USER_REPORT_REASONS: Array<{
  key: UserReportReason;
  label: string;
  description: string;
}> = [
  {
    key: 'aggressive_behavior',
    label: 'Agressão ou ameaça',
    description: 'Comportamento agressivo, ameaça, intimidação ou risco direto.',
  },
  {
    key: 'harassment',
    label: 'Assédio',
    description: 'Falas ou atitudes invasivas, constrangedoras ou de assédio.',
  },
  {
    key: 'vehicle_damage_dirty',
    label: 'Veículo inadequado',
    description: 'Veículo muito sujo, danificado ou em condição imprópria.',
  },
  {
    key: 'different_person',
    label: 'Motorista diferente do cadastro',
    description: 'Quem realizou a corrida não parecia ser o motorista cadastrado.',
  },
  {
    key: 'fraud_nonpayment',
    label: 'Fraude ou cobrança indevida',
    description: 'Cobrança incorreta, desvio suspeito ou tentativa de fraude.',
  },
  {
    key: 'illegal_or_risk',
    label: 'Situação ilegal ou de risco',
    description: 'Conduta perigosa, ilegal ou que colocou você em risco.',
  },
  {
    key: 'other',
    label: 'Outro motivo',
    description: 'Descreva o que aconteceu para nossa equipe analisar.',
  },
];

function fileExtensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  return 'jpg';
}

export async function compressReportImage(file: File): Promise<{ blob: Blob; mimeType: string }> {
  const fallbackMime = file.type || 'image/jpeg';

  if (!/^image\/(jpeg|png|webp)$/i.test(fallbackMime)) {
    return { blob: file, mimeType: fallbackMime };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      bitmap.close();
      return { blob: file, mimeType: fallbackMime };
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const outputMime = fallbackMime === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputMime, outputMime === 'image/jpeg' ? 0.78 : undefined),
    );

    return blob ? { blob, mimeType: outputMime } : { blob: file, mimeType: fallbackMime };
  } catch {
    return { blob: file, mimeType: fallbackMime };
  }
}

export async function submitPassengerUserReport(options: {
  rideId: string;
  reason: UserReportReason;
  description?: string;
  evidenceFile?: File | null;
  safetyRecordingId?: string | null;
}) {
  const { rideId, reason, description, evidenceFile, safetyRecordingId } = options;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) {
    throw new Error('Passageiro não autenticado.');
  }

  const warnings: string[] = [];
  const { data, error } = await supabase.rpc('create_user_report_tum', {
    p_ride_id: rideId,
    p_reason: reason,
    p_description: description?.trim() || null,
  });

  if (error) throw error;

  const reportId = data?.report_id as string | undefined;
  if (!reportId) {
    throw new Error('Não foi possível registrar a denúncia.');
  }

  if (safetyRecordingId) {
    const { error: recordingError } = await supabase.rpc(
      'attach_user_report_safety_recording_tum',
      {
        p_report_id: reportId,
        p_recording_id: safetyRecordingId,
      },
    );
    if (recordingError) {
      warnings.push(`A denúncia foi enviada, mas o vídeo de segurança não pôde ser vinculado: ${recordingError.message}`);
    }
  }

  if (evidenceFile) {
    let uploadedPath = '';
    try {
      const prepared = await compressReportImage(evidenceFile);
      if (prepared.blob.size > 10 * 1024 * 1024) {
        throw new Error('A foto deve ter no máximo 10 MB.');
      }

      const extension = fileExtensionForMime(prepared.mimeType);
      uploadedPath = `${userId}/${rideId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('report-evidence')
        .upload(uploadedPath, prepared.blob, {
          contentType: prepared.mimeType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: evidenceError } = await supabase.rpc('add_user_report_evidence_tum', {
        p_report_id: reportId,
        p_storage_path: uploadedPath,
        p_file_name: evidenceFile.name || null,
        p_mime_type: prepared.mimeType,
      });

      if (evidenceError) throw evidenceError;
    } catch (caughtError) {
      if (uploadedPath) {
        await supabase.storage.from('report-evidence').remove([uploadedPath]).catch(() => null);
      }
      const message = caughtError instanceof Error ? caughtError.message : 'Falha ao anexar a foto.';
      warnings.push(`A denúncia foi enviada, mas a foto não pôde ser anexada: ${message}`);
    }
  }

  return { reportId, warnings };
}
