import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.consentus.xlucis',
  appName: 'Consentus X-Lucis v2.0',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
