/**
 * Day names (days[].label). Shared by the Railway server, the Worker, and the client form.
 * Only the chosen day's label changes; stops, legs, and every other field stay as they are.
 */
export const DAY_LABEL_MAX = 24;

// C0/C1 controls, DEL, zero-width space, bidi marks/overrides/isolates, word joiners, BOM.
// ZWNJ/ZWJ (U+200C/U+200D) are kept so joined emoji survive.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Default name for the n-th day (1-based). */
export function defaultDayLabel(n) {
  return `D${n}`;
}

/** Characters as people count them: code points, so CJK and emoji are one each. */
export function dayLabelLength(text) {
  return Array.from(text).length;
}

/**
 * Clean user input. Controls removed, runs of whitespace folded, ends trimmed.
 * An empty result is valid and means "reset to the default".
 */
export function cleanDayLabel(raw) {
  if (raw == null) return { ok: true, label: '' };
  if (typeof raw !== 'string') return { ok: false, error: '天數名稱格式不正確' };
  const label = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (dayLabelLength(label) > DAY_LABEL_MAX) {
    return { ok: false, error: `天數名稱最多 ${DAY_LABEL_MAX} 個字` };
  }
  return { ok: true, label };
}

/**
 * Rename one day. `day` is days[].day (the id stops refer to).
 * Blank input resets to D{n}, where n is the day's 1-based position.
 */
export function applyDayLabel(state, patch) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.days)) {
    return { ok: false, error: '行程格式不正確' };
  }
  const day = patch && typeof patch === 'object' ? patch.day : undefined;
  if (typeof day !== 'number' || !Number.isInteger(day)) {
    return { ok: false, error: '找不到這一天' };
  }
  const index = state.days.findIndex((d) => d && d.day === day);
  if (index < 0) return { ok: false, error: '找不到這一天' };

  const cleaned = cleanDayLabel(patch.label);
  if (!cleaned.ok) return cleaned;
  const label = cleaned.label || defaultDayLabel(index + 1);

  if (state.days[index].label === label) return { ok: true, unchanged: true, state, label };
  const days = state.days.map((d, i) => (i === index ? { ...d, label } : d));
  return { ok: true, unchanged: false, state: { ...state, days }, label };
}
