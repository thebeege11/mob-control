/** Key-value persistence backend. Swap for Capacitor Preferences on device if desired. */
export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class LocalStorageBackend implements KeyValueStorage {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota / private mode: ignore */
    }
  }
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export class MemoryStorage implements KeyValueStorage {
  private m = new Map<string, string>();
  get(key: string): string | null {
    return this.m.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.m.set(key, value);
  }
  remove(key: string): void {
    this.m.delete(key);
  }
}
