export function createFirstInputTimer(now: () => number): {
  shown(): void;
  input(): void;
  value(): number | null;
} {
  let shownAt: number | null = null;
  let firstInput: number | null = null;
  return {
    shown() {
      shownAt = now();
      firstInput = null;
    },
    input() {
      if (shownAt !== null && firstInput === null) firstInput = now() - shownAt;
    },
    value: () => firstInput,
  };
}
