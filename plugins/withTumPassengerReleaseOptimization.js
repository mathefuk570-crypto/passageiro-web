const fs = require('fs');
const path = require('path');
const {
  withDangerousMod,
  withGradleProperties,
} = require('@expo/config-plugins');

const PROPERTY_VALUES = {
  reactNativeArchitectures: 'armeabi-v7a,arm64-v8a,x86,x86_64',
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  'android.enablePngCrunchInReleaseBuilds': 'true',
};

function upsertGradleProperty(properties, key, value) {
  const next = properties.filter(
    (entry) => !(entry.type === 'property' && entry.key === key),
  );
  next.push({ type: 'property', key, value });
  return next;
}

function withTumPassengerReleaseOptimization(config) {
  config = withGradleProperties(config, (mod) => {
    let properties = mod.modResults;
    for (const [key, value] of Object.entries(PROPERTY_VALUES)) {
      properties = upsertGradleProperty(properties, key, value);
    }
    mod.modResults = properties;
    return mod;
  });

  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const appRoot = path.join(mod.modRequest.platformProjectRoot, 'app');
      const proguardPath = path.join(appRoot, 'proguard-rules.pro');
      const marker = '# TUM Passenger native safety recording';
      const rules = `${marker}\n-keep class expo.modules.tumsafety.** { *; }\n-dontwarn expo.modules.tumsafety.**\n`;

      let current = '';
      if (fs.existsSync(proguardPath)) {
        current = fs.readFileSync(proguardPath, 'utf8');
      }
      if (!current.includes(marker)) {
        fs.mkdirSync(path.dirname(proguardPath), { recursive: true });
        fs.writeFileSync(
          proguardPath,
          `${current.trimEnd()}\n\n${rules}`.trimStart(),
          'utf8',
        );
      }

      // COMPATIBILIDADE UNIVERSAL TUM
      // Não habilitamos ABI splits no APK local. Com reactNativeArchitectures
      // contendo ARM 32/64 + x86/x86_64, assembleRelease gera um único APK
      // universal para celulares reais e emuladores. O AAB continua sendo
      // dividido pela Play Store automaticamente para cada arquitetura.

      return mod;
    },
  ]);

  return config;
}

module.exports = withTumPassengerReleaseOptimization;
