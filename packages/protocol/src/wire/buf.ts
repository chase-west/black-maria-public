/** Little-endian, fixed-width byte writer and reader (SPEC 5.2). No varints, no bit-packing. */

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private n = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + k) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new RangeError(`u8 out of range: ${v}`);
    this.room(1);
    this.view.setUint8(this.n, v);
    this.n += 1;
    return this;
  }
  u16(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError(`u16 out of range: ${v}`);
    this.room(2);
    this.view.setUint16(this.n, v, true);
    this.n += 2;
    return this;
  }
  u32(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError(`u32 out of range: ${v}`);
    this.room(4);
    this.view.setUint32(this.n, v, true);
    this.n += 4;
    return this;
  }
  bytes(b: Uint8Array): this {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
    return this;
  }
  get length(): number {
    return this.n;
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/** Thrown by `Reader` when a read runs past the end. Decoders catch it and drop the datagram. */
export class Truncated extends Error {
  constructor() {
    super("truncated");
  }
}

export class Reader {
  private readonly view: DataView;
  private n = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private need(k: number): void {
    if (this.n + k > this.buf.length) throw new Truncated();
  }
  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.n);
    this.n += 1;
    return v;
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.n, true);
    this.n += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.n, true);
    this.n += 4;
    return v;
  }
  bytes(k: number): Uint8Array {
    this.need(k);
    const v = this.buf.slice(this.n, this.n + k);
    this.n += k;
    return v;
  }
  get remaining(): number {
    return this.buf.length - this.n;
  }
  get offset(): number {
    return this.n;
  }
}
