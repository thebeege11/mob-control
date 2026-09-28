import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.swarmsurge.game',
  appName: 'Swarm Surge',
  webDir: 'dist',
  backgroundColor: '#1b1238',
  ios: { contentInset: 'never' },
  android: { backgroundColor: '#1b1238' },
};

export default config;
