import { cleanStopHours, cleanStopNote } from '../../../server/src/stopInfo.js';

/** What a stop shows. Stops saved before these fields existed (no key, or notes: '') give ''. */
export function stopInfoView(stop: { hours?: unknown; notes?: unknown } | null | undefined) {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return { hours: text(stop?.hours), notes: text(stop?.notes) };
}

export type StopInfoPatch = { hours?: string; notes?: string };

/**
 * The patch to send after editing: only fields whose cleaned value differs from what is shown.
 * An empty string means "remove". An untouched legacy stop yields {} so nothing is written.
 */
export function stopInfoPatch(
  stop: { hours?: unknown; notes?: unknown } | null | undefined,
  draft: { hours: string; notes: string },
): { ok: true; patch: StopInfoPatch } | { ok: false; error: string } {
  const hours = cleanStopHours(draft.hours);
  if (!hours.ok) return hours;
  const notes = cleanStopNote(draft.notes);
  if (!notes.ok) return notes;
  const current = stopInfoView(stop);
  const patch: StopInfoPatch = {};
  if (hours.value !== current.hours) patch.hours = hours.value;
  if (notes.value !== current.notes) patch.notes = notes.value;
  return { ok: true, patch };
}
