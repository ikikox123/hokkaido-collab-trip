const PLACE_DIALOG_CLASS = 'place-dialog-open';

type AutocompleteLike = {
  unbindAll?: () => void;
};

type MapsEvent = {
  clearInstanceListeners: (instance: object) => void;
};

/** Google appends `.pac-container` to document.body, outside the dialog. */
export function sweepPacContainers() {
  if (document.body.classList.contains(PLACE_DIALOG_CLASS)) return;
  document.querySelectorAll('.pac-container').forEach((node) => node.remove());
}

export function holdPlaceSuggestions() {
  document.body.classList.add(PLACE_DIALOG_CLASS);
}

/**
 * Drop the Places suggestion dropdown when the add/edit dialog closes.
 * Google can reattach the node on a timer after the input unmounts, which
 * leaves an empty white box over the map. Hide it immediately and sweep again.
 */
export function releasePlaceSuggestions(
  autocomplete?: AutocompleteLike | null,
  mapsEvent?: MapsEvent | null,
) {
  document.body.classList.remove(PLACE_DIALOG_CLASS);
  if (autocomplete && mapsEvent) {
    try {
      mapsEvent.clearInstanceListeners(autocomplete);
    } catch {
      /* widget already detached */
    }
  }
  try {
    autocomplete?.unbindAll?.();
  } catch {
    /* widget already detached */
  }
  sweepPacContainers();
  window.setTimeout(sweepPacContainers, 0);
  window.setTimeout(sweepPacContainers, 250);
}
