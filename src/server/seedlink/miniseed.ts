/**
 * PARSER Y DESEMPAQUETADOR MINISEED DE 512 BYTES
 * Implementa decodificación de cabecera fija FSDH (48 bytes), Blockettes (1000)
 * y descompresión de datos Steim-1 y Steim-2 para flujos SeedLink.
 */

import { decodeSteim1, decodeSteim2, decodeGeneric } from './steim';

export interface BTime {
  year: number;
  dayOfYear: number;
  hour: number;
  minute: number;
  second: number;
  fraction10000: number; // 0.0001 segundos (0.1 ms)
  isoTime: string;
}

export interface MiniSeedRecord {
  sequenceNumber: string;
  dataQuality: string;
  station: string;
  location: string;
  channel: string;
  network: string;
  startTime: BTime;
  sampleCount: number;
  sampleRateFactor: number;
  sampleRateMultiplier: number;
  sampleRate: number; // en Hz (muestras por segundo)
  firstBlocketteOffset: number;
  dataOffset: number;
  encodingFormat: number; // 10: Steim-1, 11: Steim-2, 1: Int16, 3: Int32, etc.
  samples: Int32Array | Float32Array;
  x0?: number;
  xn?: number;
}

/**
 * Convierte BTIME de MiniSEED a fecha ISO y objeto BTime
 */
export function parseBTime(buf: Buffer, offset: number, littleEndian: boolean = false): BTime {
  const year = littleEndian ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
  const dayOfYear = littleEndian ? buf.readUInt16LE(offset + 2) : buf.readUInt16BE(offset + 2);
  const hour = buf.readUInt8(offset + 4);
  const minute = buf.readUInt8(offset + 5);
  const second = buf.readUInt8(offset + 6);
  buf.readUInt8(offset + 7); // reserved/unused
  const fraction10000 = littleEndian ? buf.readUInt16LE(offset + 8) : buf.readUInt16BE(offset + 8);

  // Calcular milisegundos desde el 1 de enero del año dado
  const jan1 = new Date(Date.UTC(year, 0, 1)).getTime();
  const msFromDays = (dayOfYear - 1) * 86400000;
  const msFromTime = (hour * 3600 + minute * 60 + second) * 1000 + Math.floor(fraction10000 / 10);
  const date = new Date(jan1 + msFromDays + msFromTime);

  return {
    year,
    dayOfYear,
    hour,
    minute,
    second,
    fraction10000,
    isoTime: date.toISOString(),
  };
}

/**
 * Calcula la tasa de muestreo (Sample Rate en Hz) de acuerdo con el estándar SEED
 */
export function calculateSampleRate(factor: number, multiplier: number): number {
  if (factor > 0 && multiplier > 0) {
    return factor * multiplier;
  } else if (factor > 0 && multiplier < 0) {
    return -factor / multiplier;
  } else if (factor < 0 && multiplier > 0) {
    return -multiplier / factor;
  } else if (factor < 0 && multiplier < 0) {
    return 1.0 / (factor * multiplier);
  }
  return 0;
}

/**
 * Desempaqueta y decodifica un paquete MiniSEED binario de 512 bytes
 */
export function parseMiniSeedRecord(rawRecord: Buffer): MiniSeedRecord | null {
  if (rawRecord.length < 512) {
    return null;
  }

  // 1. FSDH: 48 bytes iniciales
  const sequenceNumber = rawRecord.slice(0, 6).toString('ascii').trim();
  const dataQuality = rawRecord.slice(6, 7).toString('ascii').trim();
  const station = rawRecord.slice(8, 13).toString('ascii').trim();
  const location = rawRecord.slice(13, 15).toString('ascii').trim();
  const channel = rawRecord.slice(15, 18).toString('ascii').trim();
  const network = rawRecord.slice(18, 20).toString('ascii').trim();

  // Detección de orden de bytes en la cabecera fija FSDH (SEED permite Big-Endian o Little-Endian)
  const testYearBE = rawRecord.readUInt16BE(20);
  const testYearLE = rawRecord.readUInt16LE(20);
  const isHeaderLE = (testYearBE < 1970 || testYearBE > 2060) && (testYearLE >= 1970 && testYearLE <= 2060);

  const startTime = parseBTime(rawRecord, 20, isHeaderLE);
  const sampleCount = isHeaderLE ? rawRecord.readUInt16LE(30) : rawRecord.readUInt16BE(30);
  const sampleRateFactor = isHeaderLE ? rawRecord.readInt16LE(32) : rawRecord.readInt16BE(32);
  const sampleRateMultiplier = isHeaderLE ? rawRecord.readInt16LE(34) : rawRecord.readInt16BE(34);
  const sampleRate = calculateSampleRate(sampleRateFactor, sampleRateMultiplier);

  const firstBlocketteOffset = isHeaderLE ? rawRecord.readUInt16LE(46) : rawRecord.readUInt16BE(46);
  let dataOffset = isHeaderLE ? rawRecord.readUInt16LE(44) : rawRecord.readUInt16BE(44);

  // Si dataOffset no está especificado o es menor a 48, default a 64
  if (dataOffset < 48) {
    dataOffset = 64;
  }

  // 2. Localizar Blockette 1000 para conocer el formato de compresión y orden de bytes
  let encodingFormat = 11; // Steim-2 por defecto en sismología moderna
  let wordOrder = isHeaderLE ? 0 : 1; // 0 = Little-endian, 1 = Big-endian
  let bOffset = firstBlocketteOffset;

  while (bOffset > 0 && bOffset < 508) {
    const blocketteType = isHeaderLE ? rawRecord.readUInt16LE(bOffset) : rawRecord.readUInt16BE(bOffset);
    const nextOffset = isHeaderLE ? rawRecord.readUInt16LE(bOffset + 2) : rawRecord.readUInt16BE(bOffset + 2);

    if (blocketteType === 1000) {
      // Byte bOffset + 4: Formato de codificación (3: Int32, 10: Steim-1, 11: Steim-2, etc.)
      encodingFormat = rawRecord.readUInt8(bOffset + 4);
      // Byte bOffset + 5: Word order (0: Little-endian / VAX-Intel, 1: Big-endian / SPARC-Motorola)
      wordOrder = rawRecord.readUInt8(bOffset + 5);
      break;
    }

    if (nextOffset <= bOffset) break;
    bOffset = nextOffset;
  }

  const isLittleEndian = wordOrder === 0;

  // 3. Descomprimir muestras usando Steim-1, Steim-2 u otros formatos
  let samples: Int32Array | Float32Array = new Int32Array(0);
  let x0: number | undefined;
  let xn: number | undefined;

  if (sampleCount > 0 && dataOffset < rawRecord.length) {
    const dataSlice = rawRecord.slice(dataOffset);
    const dataView = new DataView(
      dataSlice.buffer,
      dataSlice.byteOffset,
      dataSlice.byteLength
    );

    try {
      if (encodingFormat === 11) {
        // Steim-2
        samples = decodeSteim2(dataView, sampleCount, isLittleEndian);
      } else if (encodingFormat === 10) {
        // Steim-1
        samples = decodeSteim1(dataView, sampleCount, isLittleEndian);
      } else {
        // Genérico (Int16, Int32, Float32, etc.)
        samples = decodeGeneric(encodingFormat, dataView, sampleCount, isLittleEndian);
      }

      // Extraer constantes X0 y Xn del primer marco si está disponible
      if (dataSlice.length >= 12) {
        x0 = isLittleEndian ? dataSlice.readInt32LE(4) : dataSlice.readInt32BE(4);
        xn = isLittleEndian ? dataSlice.readInt32LE(8) : dataSlice.readInt32BE(8);
      }
    } catch (err) {
      console.warn(`Error descomprimiendo trama ${network}.${station}.${channel}:`, err);
      // Fallback a array vacío
      samples = new Int32Array(0);
    }
  }

  return {
    sequenceNumber,
    dataQuality,
    station,
    location,
    channel,
    network,
    startTime,
    sampleCount,
    sampleRateFactor,
    sampleRateMultiplier,
    sampleRate,
    firstBlocketteOffset,
    dataOffset,
    encodingFormat,
    samples,
    x0,
    xn,
  };
}
