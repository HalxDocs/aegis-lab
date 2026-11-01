/**
 * splitmix64, ported from `internal/sim/rand.go`.
 *
 * JavaScript numbers cannot hold a 64-bit integer exactly, so the state is a
 * BigInt. The arithmetic is the same as Go's uint64 arithmetic, including the
 * wrapping, which `BigInt.asUintN(64, ...)` reproduces.
 */
const MASK = (1n << 64n) - 1n;

export const PPM_SCALE = 1_000_000;

export class Rng {
  private state: bigint;

  constructor(seed: number | bigint) {
    this.state = BigInt(seed) & MASK;
  }

  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /**
   * Reports whether a draw lands below `ppm` parts per million.
   *
   * The degenerate cases consume no draw, so a link that never drops cannot
   * shift the stream another link draws from.
   */
  hit(ppm: number): boolean {
    if (ppm <= 0) return false;
    if (ppm >= PPM_SCALE) return true;
    return Number(this.next() % BigInt(PPM_SCALE)) < ppm;
  }
}
