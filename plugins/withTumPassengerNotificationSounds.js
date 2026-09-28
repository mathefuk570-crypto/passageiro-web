const fs = require('fs');
const path = require('path');
const { withDangerousMod, withGradleProperties } = require('@expo/config-plugins');

// O expo-notifications registra os nomes dos sons, mas este plugin garante que
// os arquivos realmente existam em res/raw no APK final. Se o recurso não
// existir, Android cria o canal com o som padrão e o canal fica imutável.
const SOUND_FILES = [
  'motorista_chegou_com_voz.mp3',
  'motorista_chegou_som.mp3',
  'chegou_voz.wav',
  'chegou_som.wav',
  'va_de_tum.wav',
];

module.exports = function withTumPassengerNotificationSounds(config) {
  // O diagnóstico no aparelho mostrou que o release estava com
  // android.enableShrinkResourcesInReleaseBuilds=true. Como os sons dos
  // NotificationChannels são resolvidos dinamicamente, o shrinker removeu
  // chegou_voz/chegou_som mesmo depois de eles chegarem ao packaged_res.
  // Mantemos o minify ligado e desligamos SOMENTE o resource shrinker.
  config = withGradleProperties(config, (mod) => {
    const key = 'android.enableShrinkResourcesInReleaseBuilds';
    const properties = mod.modResults;
    const existing = properties.find(
      (item) => item.type === 'property' && item.key === key,
    );

    if (existing) {
      existing.value = 'false';
    } else {
      properties.push({ type: 'property', key, value: 'false' });
    }

    return mod;
  });

  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const sourceDir = path.join(mod.modRequest.projectRoot, 'public', 'sounds');
      const rawDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'raw',
      );

      fs.mkdirSync(rawDir, { recursive: true });

      for (const fileName of SOUND_FILES) {
        const source = path.join(sourceDir, fileName);
        const target = path.join(rawDir, fileName);
        if (!fs.existsSync(source)) {
          throw new Error(`[TUM] Som de notificação ausente: ${source}`);
        }
        fs.copyFileSync(source, target);
      }

      // O release usa resource shrinking. Como estes sons são referenciados
      // dinamicamente pelo NotificationChannel, o shrinker não enxerga o uso e
      // pode removê-los do APK. tools:keep impede essa remoção.
      const keepXml = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@raw/chegou_voz,@raw/chegou_som,@raw/motorista_chegou_com_voz,@raw/motorista_chegou_som,@raw/va_de_tum" />
`;
      fs.writeFileSync(path.join(rawDir, 'keep.xml'), keepXml, 'utf8');

      return mod;
    },
  ]);
};
