import { createHash, timingSafeEqual } from 'node:crypto';

// Hash first so timingSafeEqual always compares buffers of equal length.
export function secretMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(expected).digest(),
  );
}
