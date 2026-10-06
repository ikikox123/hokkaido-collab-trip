/**
 * Client address for the register rate limit.
 * Railway's edge sets X-Real-IP and overwrites any client-supplied value.
 * X-Forwarded-For is ignored: a caller can spoof it, and the rightmost hop
 * can be an internal proxy address shared by every visitor.
 */
export function clientIp(req) {
  const header = req?.headers?.['x-real-ip'];
  let ip = '';
  if (typeof header === 'string') {
    ip = header.split(',')[0].trim();
  } else if (Array.isArray(header)) {
    const first = header.find((part) => typeof part === 'string');
    ip = typeof first === 'string' ? first.split(',')[0].trim() : '';
  }
  if (!ip) {
    const address = req?.socket?.remoteAddress;
    ip = typeof address === 'string' ? address : '';
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
  return ip || 'unknown';
}
