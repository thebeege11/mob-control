/** Haptics abstraction. Web uses navigator.vibrate; native builds can plug in @capacitor/haptics. */
export interface HapticsProvider {
  impact(strength: 'light' | 'medium' | 'heavy'): void;
}

export class WebHaptics implements HapticsProvider {
  enabled = true;
  impact(strength: 'light' | 'medium' | 'heavy'): void {
    if (!this.enabled) return;
    const ms = strength === 'light' ? 8 : strength === 'medium' ? 18 : 35;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* unsupported */
    }
  }
}
