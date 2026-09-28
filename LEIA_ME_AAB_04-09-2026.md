TUM Passageiro — correção AAB / ABI splits

Corrige o erro:
"Please disable building multiple APKs when building an Android app bundle."

Comportamento:
- assembleRelease: mantém APK separado armeabi-v7a e arm64-v8a.
- bundleRelease: desativa ABI splits e gera um único app-release.aab.

Como o plugin gera android/app/build.gradle durante o prebuild, depois de copiar este patch é necessário executar novamente:
npx expo prebuild --platform android --clean

e depois:
cd android
gradlew.bat bundleRelease
