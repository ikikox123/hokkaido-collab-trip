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
