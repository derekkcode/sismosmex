/**
 * ALMACÉN DEL HISTORIAL SÍSMICO EN MONGODB
 * Guarda los sismos del monitor en la colección `earthquakes` de la base indicada en MONGODB_DB.
 * La conexión usa MONGODB_URI (definida en .env, no versionada).
 */

import { MongoClient, Collection } from 'mongodb';
import type { DetectedEarthquake } from './detector';

const DEFAULT_DB = 'sismosmex';
const COLLECTION = 'earthquakes';

export class EarthquakeHistoryStore {
  private client: MongoClient | null = null;
  private collection: Collection | null = null;

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
    this.client = client;
    this.collection = client.db(process.env.MONGODB_DB || DEFAULT_DB).collection(COLLECTION);
  }

  private requireCollection(): Collection {
    if (!this.collection) throw new Error('MongoDB no está conectado');
    return this.collection;
  }

  public async loadAll(): Promise<DetectedEarthquake[]> {
    const docs = await this.requireCollection().find({}).sort({ timeEpoch: -1 }).toArray();
    return docs.map((doc: any) => {
      const { _id, ...rest } = doc;
      return { ...rest, id: rest.id ?? String(_id) } as DetectedEarthquake;
    });
  }

  /** Inserta o reemplaza cada evento (clave `_id` = id del evento) y elimina los que ya no están en la lista. */
  public async saveAll(events: DetectedEarthquake[]): Promise<void> {
    const col = this.requireCollection();
    const ids = events.map((e) => e.id);
    if (events.length > 0) {
      await col.bulkWrite(
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
    await col.deleteMany(ids.length > 0 ? { _id: { $nin: ids } as any } : {});
  }

  public async clear(): Promise<void> {
    await this.requireCollection().deleteMany({});
  }

  public async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
    this.collection = null;
  }
}
