export const STOP_HOURS_MAX: number;
export const STOP_NOTE_MAX: number;
export const STOP_NOTE_MAX_LINES: number;
export function stopTextLength(text: string): number;
type Cleaned = { ok: true; value: string } | { ok: false; error: string };
export function cleanStopHours(raw: unknown): Cleaned;
export function cleanStopNote(raw: unknown): Cleaned;
export function cleanStopInfo(
  input: unknown,
): { ok: true; set: { hours?: string; notes?: string }; remove: Array<'hours' | 'notes'> } | { ok: false; error: string };
