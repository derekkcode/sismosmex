/**
 * DECODIFICADOR STEIM-1 Y STEIM-2 PURO (ZERO DEPENDENCIES)
 * Especificación SEED Standard Format Manual (Apéndice B)
 * Soporta descompresión de tramas binarias de diferencias de primer orden.
 */

function signExtend(value: number, bits: number): number {
  const shift = 32 - bits;
  return (value << shift) >> shift;
}

/**
 * Decodifica tramas comprimidas en formato Steim-1
 */
export function decodeSteim1(dataView: DataView, numSamples: number, littleEndian: boolean = false): Int32Array {
  const samples = new Int32Array(numSamples);
  let sampleIndex = 0;
  let offset = 0;
  const byteLength = dataView.byteLength;
  let frameIdx = 0;

  while (offset + 64 <= byteLength && sampleIndex < numSamples) {
    const w0 = dataView.getUint32(offset, littleEndian);
    const nibbles: number[] = new Array(16);
    for (let i = 0; i < 16; i++) {
      nibbles[i] = (w0 >>> (30 - 2 * i)) & 0x03;
    }

    let startWord = 1;
    if (frameIdx === 0) {
      const x0 = dataView.getInt32(offset + 4, littleEndian);
      if (sampleIndex < numSamples) {
        samples[sampleIndex++] = x0;
      }
      startWord = 3;
    }

    for (let w = startWord; w < 16 && sampleIndex < numSamples; w++) {
      const nib = nibbles[w];
      const val = dataView.getUint32(offset + w * 4, littleEndian);

      if (nib === 1) {
        // Cuatro diferencias de 8 bits
        for (let b = 0; b < 4 && sampleIndex < numSamples; b++) {
          const shift = 24 - 8 * b;
          const diff = signExtend((val >>> shift) & 0xff, 8);
          samples[sampleIndex] = samples[sampleIndex - 1] + diff;
          sampleIndex++;
        }
      } else if (nib === 2) {
        // Dos diferencias de 16 bits
        for (let b = 0; b < 2 && sampleIndex < numSamples; b++) {
          const shift = 16 - 16 * b;
          const diff = signExtend((val >>> shift) & 0xffff, 16);
          samples[sampleIndex] = samples[sampleIndex - 1] + diff;
          sampleIndex++;
        }
      } else if (nib === 3) {
        // Una diferencia de 32 bits
        const diff = signExtend(val, 32);
        samples[sampleIndex] = samples[sampleIndex - 1] + diff;
        sampleIndex++;
      }
    }

    offset += 64;
    frameIdx++;
  }

  return samples.subarray(0, sampleIndex);
}

/**
 * Decodifica tramas comprimidas en formato Steim-2
 */
export function decodeSteim2(dataView: DataView, numSamples: number, littleEndian: boolean = false): Int32Array {
  const samples = new Int32Array(numSamples);
  let sampleIndex = 0;
  let offset = 0;
  const byteLength = dataView.byteLength;
  let frameIdx = 0;

  while (offset + 64 <= byteLength && sampleIndex < numSamples) {
    const w0 = dataView.getUint32(offset, littleEndian);
    const nibbles: number[] = new Array(16);
    for (let i = 0; i < 16; i++) {
      nibbles[i] = (w0 >>> (30 - 2 * i)) & 0x03;
    }

    let startWord = 1;
    if (frameIdx === 0) {
      const x0 = dataView.getInt32(offset + 4, littleEndian);
      if (sampleIndex < numSamples) {
        samples[sampleIndex++] = x0;
      }
      startWord = 3;
    }

    for (let w = startWord; w < 16 && sampleIndex < numSamples; w++) {
      const nib = nibbles[w];
      const val = dataView.getUint32(offset + w * 4, littleEndian);

      if (nib === 1) {
        // 4 diferencias de 8 bits
        for (let i = 0; i < 4 && sampleIndex < numSamples; i++) {
          const diff = signExtend((val >>> (24 - 8 * i)) & 0xff, 8);
          samples[sampleIndex] = samples[sampleIndex - 1] + diff;
          sampleIndex++;
        }
      } else if (nib === 2) {
        const dnib = (val >>> 30) & 0x03;
        if (dnib === 1) {
          // 1 diferencia de 30 bits
          if (sampleIndex < numSamples) {
            const diff = signExtend(val & 0x3fffffff, 30);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff;
            sampleIndex++;
          }
        } else if (dnib === 2) {
          // 2 diferencias de 15 bits
          if (sampleIndex < numSamples) {
            const diff0 = signExtend((val >>> 15) & 0x7fff, 15);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff0;
            sampleIndex++;
          }
          if (sampleIndex < numSamples) {
            const diff1 = signExtend(val & 0x7fff, 15);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff1;
            sampleIndex++;
          }
        } else if (dnib === 3) {
          // 3 diferencias de 10 bits
          if (sampleIndex < numSamples) {
            const diff0 = signExtend((val >>> 20) & 0x3ff, 10);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff0;
            sampleIndex++;
          }
          if (sampleIndex < numSamples) {
            const diff1 = signExtend((val >>> 10) & 0x3ff, 10);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff1;
            sampleIndex++;
          }
          if (sampleIndex < numSamples) {
            const diff2 = signExtend(val & 0x3ff, 10);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff2;
            sampleIndex++;
          }
        }
      } else if (nib === 3) {
        const dnib = (val >>> 30) & 0x03;
        if (dnib === 0) {
          // 5 diferencias de 6 bits
          for (let i = 0; i < 5 && sampleIndex < numSamples; i++) {
            const diff = signExtend((val >>> (24 - 6 * i)) & 0x3f, 6);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff;
            sampleIndex++;
          }
        } else if (dnib === 1) {
          // 6 diferencias de 5 bits
          for (let i = 0; i < 6 && sampleIndex < numSamples; i++) {
            const diff = signExtend((val >>> (25 - 5 * i)) & 0x1f, 5);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff;
            sampleIndex++;
          }
        } else if (dnib === 2) {
          // 7 diferencias de 4 bits
          for (let i = 0; i < 7 && sampleIndex < numSamples; i++) {
            const diff = signExtend((val >>> (24 - 4 * i)) & 0x0f, 4);
            samples[sampleIndex] = samples[sampleIndex - 1] + diff;
            sampleIndex++;
          }
        }
      }
    }

    offset += 64;
    frameIdx++;
  }

  return samples.subarray(0, sampleIndex);
}

/**
 * Decodifica formatos enteros o flotantes genéricos
 */
export function decodeGeneric(
  format: number,
  dataView: DataView,
  numSamples: number,
  littleEndian: boolean = false
): Int32Array | Float32Array {
  if (format === 1) {
    // 16-bit integer
    const result = new Int32Array(numSamples);
    const limit = Math.min(numSamples, Math.floor(dataView.byteLength / 2));
    for (let i = 0; i < limit; i++) {
      result[i] = dataView.getInt16(i * 2, littleEndian);
    }
    return result;
  }
  if (format === 3) {
    // 32-bit integer
    const result = new Int32Array(numSamples);
    const limit = Math.min(numSamples, Math.floor(dataView.byteLength / 4));
    for (let i = 0; i < limit; i++) {
      result[i] = dataView.getInt32(i * 4, littleEndian);
    }
    return result;
  }
  if (format === 4) {
    // 32-bit float
    const result = new Float32Array(numSamples);
    const limit = Math.min(numSamples, Math.floor(dataView.byteLength / 4));
    for (let i = 0; i < limit; i++) {
      result[i] = dataView.getFloat32(i * 4, littleEndian);
    }
    return result;
  }
  return new Int32Array(0);
}
