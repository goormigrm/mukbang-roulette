// socket.io-client v2에는 자체 타입 선언이 없어 최소한의 형태만 선언한다
declare module 'socket.io-client' {
  export interface ChzzkSocket {
    on(event: string, cb: (data: unknown) => void): void
    disconnect(): void
    connected: boolean
  }
  function io(url: string, opts?: Record<string, unknown>): ChzzkSocket
  export default io
}
