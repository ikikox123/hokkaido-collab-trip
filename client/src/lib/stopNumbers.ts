export type StopOrderRef = {
  id: string;
  day: number;
};

/**
 * 1-based stop number within each day, following the current array order.
 * Call again with the latest list after a reorder, add, or delete.
 * Every day starts over at 1, including when days are interleaved.
 */
export function stopNumberById(stops: readonly StopOrderRef[]): Map<string, number> {
  const countByDay = new Map<number, number>();
  const numbers = new Map<string, number>();
  for (const stop of stops) {
    const number = (countByDay.get(stop.day) ?? 0) + 1;
    countByDay.set(stop.day, number);
    numbers.set(stop.id, number);
  }
  return numbers;
}
