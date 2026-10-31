// 테스트는 Node에서 돈다 — state.ts가 읽고 쓰는 브라우저 localStorage를 메모리로 흉내 낸다
const mem = new Map<string, string>()

globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
} as Storage
