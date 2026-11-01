import { describe, expect, it } from 'vitest';
import { unpackPath } from './packed-path';

describe('PDF.js 6 packed paths', () => {
  it('decodes lines and closed cubic paths', () => {
    expect(unpackPath(new Float32Array([0, 10, 20, 1, 100, 20, 2, 100, 30, 20, 40, 10, 20, 4])))
      .toEqual({ ops: [13, 14, 15, 18], coords: [10, 20, 100, 20, 100, 30, 20, 40, 10, 20] });
  });
  it('converts quadratic controls to equivalent cubic controls', () => {
    const result = unpackPath([0, 0, 0, 3, 3, 6, 9, 0]);
    expect(result).toEqual({ ops: [13, 15], coords: [0, 0, 2, 4, 5, 4, 9, 0] });
  });
  it('rejects malformed and unknown operators', () => {
    expect(() => unpackPath([0, 1])).toThrow('Invalid packed PDF path');
    expect(() => unpackPath([42])).toThrow('Invalid packed PDF path');
  });
});
