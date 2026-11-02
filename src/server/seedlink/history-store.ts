/**
 * ALMACÉN DEL HISTORIAL SÍSMICO EN MONGODB
 * Guarda los sismos del monitor en la colección `earthquakes` de la base indicada en MONGODB_DB.
 * La conexión usa MONGODB_URI (definida en .env, no versionada).
 */

import { MongoClient, Collection } from 'mongodb';
import type { DetectedEarthquake } from './detector';

const DEFAULT_DB = 'sismosmex';
const COLLECTION = 'earthquakes';
// Momento de la última limpieza: los sismos de USGS anteriores a él no deben volver al historial
const META_COLLECTION = 'meta';
const CLEARED_AT_ID = 'history_cleared_at';
// Mismo tope que la memoria del detector: al cargar se usan los 100 más recientes; el resto permanece en la base.
const LOAD_LIMIT = 100;

export class EarthquakeHistoryStore {
  private client: MongoClient | null = null;
  private collection: Collection | null = null;
  private meta: Collection | null = null;

  public isConnected(): boolean {
    return this.collection !== null;
  }

  public async connect(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI no está definida (revisa el archivo .env)');
    }
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    try {
      await client.connect();
      await client.db('admin').command({ ping: 1 });
    } catch (err) {
      await client.close().catch(() => undefined);
      throw err;
    }
    const db = client.db(process.env.MONGODB_DB || DEFAULT_DB);
    this.client = client;
    this.collection = db.collection(COLLECTION);
    this.meta = db.collection(META_COLLECTION);
  }

  private requireCollection(): Collection {
    if (!this.collection) throw new Error('MongoDB no está conectado');
    return this.collection;
  }

  private requireMeta(): Collection {
    if (!this.meta) throw new Error('MongoDB no está conectado');
    return this.meta;
  }

  public async loadAll(): Promise<DetectedEarthquake[]> {
    const docs = await this.requireCollection().find({}).sort({ timeEpoch: -1 }).limit(LOAD_LIMIT).toArray();
    return docs.map((doc: any) => {
      const { _id, ...rest } = doc;
      return { ...rest, id: rest.id ?? String(_id) } as DetectedEarthquake;
    });
  }

  /** Inserta o reemplaza cada evento (clave `_id` = id del evento). Nunca elimina por ausencia: los borrados son explícitos. */
  public async saveAll(events: DetectedEarthquake[]): Promise<void> {
    if (events.length === 0) return;
    await this.requireCollection().bulkWrite(
      events.map((e) => ({
        replaceOne: {
          filter: { _id: e.id as any },
          replacement: { ...e, _id: e.id } as any,
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  /** Elimina solo los eventos indicados (cancelados, expirados o fusionados). */
  public async deleteIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.requireCollection().deleteMany({ _id: { $in: ids } } as any);
  }

  /** Momento (ms) de la última limpieza; 0 si el historial nunca se limpió. */
  public async getClearedAt(): Promise<number> {
    const doc = await this.requireMeta().findOne({ _id: CLEARED_AT_ID as any });
    return typeof doc?.clearedAtMs === 'number' ? doc.clearedAtMs : 0;
  }

  /** Guarda el momento del corte y borra todo el historial. Solo para limpiezas solicitadas explícitamente. */
  public async clear(clearedAtMs: number): Promise<void> {
    // El corte se escribe antes del borrado: aunque falle el borrado, los sismos anteriores siguen fuera de USGS
    await this.requireMeta().updateOne({ _id: CLEARED_AT_ID as any }, { $max: { clearedAtMs } }, { upsert: true });
    await this.requireCollection().deleteMany({});
  }

  public async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
    this.collection = null;
    this.meta = null;
  }
}
