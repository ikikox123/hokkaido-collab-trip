export type PlaceSelection = {
  title: string;
  address: string;
  /** Value for the search field: the formatted address when we have one. */
  search: string;
};

/**
 * Places often returns a suggestion description that glues the landmark name
 * and the formatted address together. The itinerary title should stay the
 * landmark; the search field keeps the address.
 */
export function selectionFromPlace(input: {
  name?: string | null;
  formattedAddress?: string | null;
}): PlaceSelection {
  const address = String(input.formattedAddress ?? '').trim();
  let label = String(input.name ?? '').trim();
  if (address && label && label !== address && label.includes(address)) {
    label = label
      .split(address)
      .join('')
      .replace(/^[\s,、，]+|[\s,、，]+$/g, '')
      .trim();
  }
  if (!label) label = address;
  return {
    title: label || '新站點',
    address,
    search: address || label,
  };
}

/**
 * True when `name` is empty, is the address itself, contains the address, or has a postal mark (〒).
 * Geocoding fallbacks name a place by its address, which can never match an OpenStreetMap name.
 */
export function looksLikeAddress(name: string | null | undefined, address: string | null | undefined): boolean {
  const n = String(name ?? '').trim();
  const a = String(address ?? '').trim();
  if (!n) return true;
  if (n.includes('〒')) return true;
  return Boolean(a) && (n === a || n.includes(a));
}

/**
 * Names to try for the free opening-hours lookup, best first, at most two.
 * The place name comes first unless it is address-like; then what the user typed in the search box,
 * then the stop name they have filled in. Address-like text is never sent.
 */
export function openingHoursNames(input: {
  name?: string | null;
  address?: string | null;
  searchText?: string | null;
  title?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [input.name, input.searchText, input.title]) {
    const text = String(raw ?? '').trim();
    if (!text || looksLikeAddress(text, input.address)) continue;
    const key = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, 2);
}
