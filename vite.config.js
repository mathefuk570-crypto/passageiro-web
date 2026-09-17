import { defineConfig } from 'vite';
export default defineConfig({define:{'process.env.EXPO_BASE_URL':JSON.stringify('/'),'process.env.EXPO_DOM_HOST_OS':'undefined'},build:{target:'es2020'}});
