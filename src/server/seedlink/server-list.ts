/**
 * CATÁLOGO DE SERVIDORES SEEDLINK TCP Y CONFIGURACIÓN DE TIMEOUT (20S)
 * Lista provista con 25 nodos sísmicos del SSN, Raspberry Shake e INETER.
 */

export interface SeedLinkServerDefinition {
  id: string;
  name: string;
  host: string;
  port: number;
  timeoutSec: number;
  stationCode?: string;
  networkCode?: string;
  isPrimary?: boolean;
  priority?: number;
}

export interface SeedLinkServerStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  timeoutSec: number;
  status: 'Done' | 'Network error: Connect timed out' | 'Connecting...' | string;
  packetsReceived: number;
  bytesReceived: number;
  bitrateKbps: number;
  lastPacketTime: string | null;
  serverVersion: string;
  isPrimary?: boolean;
  priority?: number;
}

export const SEEDLINK_SERVERS: SeedLinkServerDefinition[] = [
  // 1. SERVIDOR TRONCAL PRIMARIO PRIORITARIO (SSN - UNAM)
  {
    id: 'ssn',
    name: 'ssn nunca muere',
    host: '132.247.71.12',
    port: 18000,
    timeoutSec: 20,
    networkCode: 'IG',
    isPrimary: true,
    priority: 1,
  },
  // 2. SERVIDOR FDSN (EarthScope): solo se suscriben sus estaciones dentro de México (ver multi-pool)
  { id: 'fdsn_mx', name: 'FDSN EarthScope (México)', host: 'rtserve.earthscope.org', port: 18000, timeoutSec: 20, priority: 2 },
  // 3. SERVIDORES DE ESTACIONES SÍSMICAS REGIONALES Y CIUDADANAS (RED AM & INETER)
  { id: 'rc67e', name: 'RC67E', host: '132.248.198.89', port: 18000, timeoutSec: 20, stationCode: 'RC67E', networkCode: 'AM', priority: 2 },
  { id: 'raa84', name: 'RAA84', host: '132.248.94.155', port: 18000, timeoutSec: 20, stationCode: 'RAA84', networkCode: 'AM', priority: 2 },
  { id: 'rbff6', name: 'RBFF6', host: '132.248.105.18', port: 18000, timeoutSec: 20, stationCode: 'RBFF6', networkCode: 'AM', priority: 2 },
  { id: 'r3389', name: 'R3389', host: '132.247.97.5', port: 18000, timeoutSec: 20, stationCode: 'R3389', networkCode: 'AM', priority: 2 },
  { id: 'r1cc0', name: 'R1CC0', host: '132.247.137.210', port: 18000, timeoutSec: 20, stationCode: 'R1CC0', networkCode: 'AM', priority: 2 },
  { id: 'r0e45', name: 'R0E45', host: '132.248.82.55', port: 18000, timeoutSec: 20, stationCode: 'R0E45', networkCode: 'AM', priority: 2 },
  { id: 'rdd27', name: 'RDD27', host: '132.248.92.71', port: 18000, timeoutSec: 20, stationCode: 'RDD27', networkCode: 'AM', priority: 2 },
  { id: 'rd7c5', name: 'RD7C5', host: '132.248.89.58', port: 18000, timeoutSec: 20, stationCode: 'RD7C5', networkCode: 'AM', priority: 2 },
  { id: 'quere', name: 'QUERE', host: '132.248.185.59', port: 18000, timeoutSec: 20, stationCode: 'QUERE', networkCode: 'AM', priority: 2 },
  { id: 're8bc', name: 'RE8BC', host: '132.248.30.55', port: 18000, timeoutSec: 20, stationCode: 'RE8BC', networkCode: 'AM', priority: 2 },
  { id: 'r4903', name: 'R4903', host: '132.248.88.55', port: 18000, timeoutSec: 20, stationCode: 'R4903', networkCode: 'AM', priority: 2 },
  { id: 'r8f30', name: 'R8F30', host: '132.248.93.231', port: 18000, timeoutSec: 20, stationCode: 'R8F30', networkCode: 'AM', priority: 2 },
  { id: 'r30b4', name: 'R30B4', host: '132.248.30.35', port: 18000, timeoutSec: 20, stationCode: 'R30B4', networkCode: 'AM', priority: 2 },
  { id: 'r784b', name: 'R784B', host: '132.248.251.251', port: 18000, timeoutSec: 20, stationCode: 'R784B', networkCode: 'AM', priority: 2 },
  { id: 'rfecb', name: 'RFECB', host: '132.248.96.43', port: 18000, timeoutSec: 20, stationCode: 'RFECB', networkCode: 'AM', priority: 2 },
  { id: 'rac53', name: 'RAC53', host: '132.248.86.169', port: 18000, timeoutSec: 20, stationCode: 'RAC53', networkCode: 'AM', priority: 2 },
  { id: 'ineter1', name: 'INETER 1', host: '165.98.224.46', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'ineter2', name: 'ineter2', host: '165.98.224.59', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'ineter3', name: 'ineter3', host: '165.98.224.52', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'inete4', name: 'inete4', host: '165.98.224.38', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'mas_estaciones', name: 'mas estaciones', host: '165.98.224.36', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'ineter_ca', name: 'INETER Centroamérica', host: '165.98.224.42', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'ineter_sv', name: 'INETER El Salvador', host: '165.98.224.54', port: 18000, timeoutSec: 20, priority: 3 },
  { id: 'ineter_hn', name: 'INETER Honduras', host: '165.98.224.50', port: 18000, timeoutSec: 20, priority: 3 },
];
