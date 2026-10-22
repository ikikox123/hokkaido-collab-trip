export const DAY_LABEL_MAX: number;
export function defaultDayLabel(n: number): string;
export function dayLabelLength(text: string): number;
export function cleanDayLabel(raw: unknown): { ok: true; label: string } | { ok: false; error: string };
