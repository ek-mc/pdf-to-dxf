/** Decode the packed DrawOPS stream returned by PDF.js 6 constructPath. */
export function unpackPath(data: ArrayLike<number>): { ops: number[]; coords: number[] } {
  const ops: number[] = [];
  const coords: number[] = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  let i = 0;
  while (i < data.length) {
    const op = data[i++];
    const count = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : op === 4 ? 0 : -1;
    if (count < 0 || i + count > data.length) throw new Error('Invalid packed PDF path');
    const values = Array.from({ length: count }, () => data[i++]);
    if (op === 0 || op === 1) {
      ops.push(op === 0 ? 13 : 14);
      coords.push(...values);
      [x, y] = values;
      if (op === 0) { startX = x; startY = y; }
    } else if (op === 2) {
      ops.push(15);
      coords.push(...values);
      [x, y] = values.slice(4);
    } else if (op === 3) {
      const [cx, cy, endX, endY] = values;
      ops.push(15);
      coords.push(x + 2 / 3 * (cx - x), y + 2 / 3 * (cy - y),
        endX + 2 / 3 * (cx - endX), endY + 2 / 3 * (cy - endY), endX, endY);
      x = endX; y = endY;
    } else {
      ops.push(18);
      x = startX; y = startY;
    }
  }
  return { ops, coords };
}
