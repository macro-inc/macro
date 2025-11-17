export class MockLocalStorage {
  store: Record<string, string> = {};

  getItem(key: string) {
    return this.store[key] || null;
  }

  setItem(key: string, value: string) {
    this.store[key] = value;
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }
}


export function mockLocalStorage(): MockLocalStorage {
  const localStorage = new MockLocalStorage();
  Object.defineProperty(global, 'localStorage', { value: localStorage });
  return localStorage;
}


