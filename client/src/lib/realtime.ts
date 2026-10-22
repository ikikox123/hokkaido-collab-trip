import { io } from 'socket.io-client';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Listener = (...args: any[]) => void;
type AckCallback = (err: unknown, res?: any) => void;

/** The part of a Socket.io client the app uses. The Workers build implements it over a plain WebSocket. */
export interface RealtimeSocket {
  on(event: string, listener: Listener): unknown;
  emit(event: string, payload?: unknown, ack?: (res: any) => void): unknown;
  timeout(ms: number): { emit(event: string, payload: unknown, ack: AckCallback): unknown };
  disconnect(): unknown;
}

/**
 * Socket.io-shaped client for the Cloudflare Durable Object.
 * Frames: {t:'emit', event, data, ack?} up; {t:'event', event, data} and {t:'ack', id, data} down.
 * Reconnects with backoff and buffers emits while offline, like Socket.io.
 */
class WsSocket implements RealtimeSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private acks = new Map<number, (data: unknown) => void>();
  private nextAck = 1;
  private queue: string[] = [];
  private closed = false;
  private retry = 0;
  private heartbeat: number | undefined;

  constructor(private url: string) {
    this.open();
  }

  private open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const frame of this.queue.splice(0)) ws.send(frame);
      window.clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25_000);
      this.fire('connect');
    };
    ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      let msg: { t?: string; event?: string; data?: unknown; id?: number };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.t === 'event' && msg.event) this.fire(msg.event, msg.data);
      else if (msg.t === 'ack' && typeof msg.id === 'number') {
        const done = this.acks.get(msg.id);
        this.acks.delete(msg.id);
        done?.(msg.data);
      }
    };
    ws.onclose = () => {
      window.clearInterval(this.heartbeat);
      if (this.ws !== ws) return;
      this.ws = null;
      this.fire('disconnect');
      if (this.closed) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.open(), delay);
    };
  }

  private fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  private send(event: string, payload: unknown, ack?: (data: unknown) => void) {
    const frame: Record<string, unknown> = { t: 'emit', event, data: payload ?? {} };
    if (ack) {
      const id = this.nextAck++;
      this.acks.set(id, ack);
      frame.ack = id;
    }
    const text = JSON.stringify(frame);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.queue.push(text);
  }

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  emit(event: string, payload?: unknown, ack?: (res: any) => void) {
    this.send(event, payload, ack);
    return this;
  }

  timeout(ms: number) {
    return {
      emit: (event: string, payload: unknown, ack: AckCallback) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          ack(new Error('timeout'));
        }, ms);
        this.send(event, payload, (data) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          ack(null, data);
        });
        return this;
      },
    };
  }

  disconnect() {
    this.closed = true;
    window.clearInterval(this.heartbeat);
    this.ws?.close();
    this.ws = null;
    return this;
  }
}

/** VITE_REALTIME=ws (the Cloudflare build) uses /ws; anything else keeps Socket.io for the Node server. */
export function connectRealtime(): RealtimeSocket {
  if (import.meta.env.VITE_REALTIME === 'ws') {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return new WsSocket(`${scheme}://${window.location.host}/ws`);
  }
  return io({ path: '/socket.io', transports: ['websocket', 'polling'] }) as unknown as RealtimeSocket;
}
