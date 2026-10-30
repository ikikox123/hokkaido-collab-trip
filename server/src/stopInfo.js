/**
 * Optional stop details: opening hours (stop.hours) and the free-text note (stop.notes).
 * Shared by the Railway server, the Worker, and the client editor.
 * An empty value means "no value": the key is removed from the stop, never stored as ''.
 */
export const STOP_HOURS_MAX = 80;
export const STOP_NOTE_MAX = 300;
export const STOP_NOTE_MAX_LINES = 3;

// C0/C1 controls (newline handled separately), DEL, zero-width space, bidi marks/overrides/isolates,
// word joiners, BOM. ZWNJ/ZWJ (U+200C/U+200D) are kept so joined emoji survive.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Characters as people count them: code points, so CJK and emoji are one each. */
export function stopTextLength(text) {
  return Array.from(text).length;
}

function stripControls(text) {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
}

/** Opening hours: one line. Line breaks and runs of whitespace fold into single spaces. */
export function cleanStopHours(raw) {
  if (raw == null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: '營業時間格式不正確' };
  const value = stripControls(raw).replace(/\s+/g, ' ').trim();
  if (stopTextLength(value) > STOP_HOURS_MAX) {
    return { ok: false, error: `營業時間最多 ${STOP_HOURS_MAX} 個字` };
  }
  return { ok: true, value };
}

/** Note: up to three non-empty lines. Spaces inside a line are folded; blank lines are dropped. */
export function cleanStopNote(raw) {
  if (raw == null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: '備註格式不正確' };
  const lines = stripControls(raw)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length > STOP_NOTE_MAX_LINES) {
    return { ok: false, error: `備註最多 ${STOP_NOTE_MAX_LINES} 行` };
  }
  const value = lines.join('\n');
  if (stopTextLength(value) > STOP_NOTE_MAX) {
    return { ok: false, error: `備註最多 ${STOP_NOTE_MAX} 個字` };
  }
  return { ok: true, value };
}

/**
 * Clean the optional fields of a patch or a new stop.
 * Returns { ok: true, set, remove }: `set` holds non-empty values to write, `remove` the keys to delete.
 * Only keys present in `input` are looked at.
 */
export function cleanStopInfo(input) {
  const set = {};
  const remove = [];
  const source = input && typeof input === 'object' ? input : {};
  for (const [key, clean] of [['hours', cleanStopHours], ['notes', cleanStopNote]]) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const result = clean(source[key]);
    if (!result.ok) return result;
    if (result.value) set[key] = result.value;
    else remove.push(key);
  }
  return { ok: true, set, remove };
}
