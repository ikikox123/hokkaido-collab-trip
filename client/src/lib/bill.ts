import type { Socket } from 'socket.io-client';

export function emitAck(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err: unknown, res?: { ok?: boolean; error?: string }) => {
      if (err) resolve({ ok: false, error: '連線逾時，請再試一次' });
      else resolve({ ok: Boolean(res?.ok), error: res?.error });
    });
  });
}

export function downloadText(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
