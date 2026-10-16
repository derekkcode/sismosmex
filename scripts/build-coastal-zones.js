import fs from 'fs';
import path from 'path';

const mxPath = path.resolve('desing/map/mx_states.json');
const caPath = path.resolve('desing/map/centroamerica.json');

const mx = JSON.parse(fs.readFileSync(mxPath, 'utf8'));
const ca = JSON.parse(fs.readFileSync(caPath, 'utf8'));

function getMainPoly(feat) {
  if (!feat) return [];
  if (feat.geometry.type === 'Polygon') return feat.geometry.coordinates[0];
  if (feat.geometry.type === 'MultiPolygon') {
    // Return largest ring
    let maxRing = [];
    for (const poly of feat.geometry.coordinates) {
      const ring = poly[0];
      if (ring.length > maxRing.length) maxRing = ring;
    }
    return maxRing;
  }
  return [];
}

function extractContiguousCoast(poly, testFn) {
  if (!poly || poly.length === 0) return [];
  
  // Find longest contiguous run of points passing testFn
  const runs = [];
  let currentRun = [];

  for (let i = 0; i < poly.length; i++) {
    const pt = poly[i];
    if (testFn(pt[0], pt[1])) {
      currentRun.push(pt);
    } else {
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    }
  }
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  // Handle wrap-around if poly is closed
  if (runs.length > 1) {
    const firstPt = poly[0];
    const lastPt = poly[poly.length - 1];
    if (testFn(firstPt[0], firstPt[1]) && testFn(lastPt[0], lastPt[1])) {
      const wrapped = runs[runs.length - 1].concat(runs[0]);
      runs[0] = wrapped;
      runs.pop();
    }
  }

  if (runs.length === 0) return [];
  runs.sort((a, b) => b.length - a.length);
  return runs[0];
}

const findMx = (name) => mx.features.find(f => (f.properties.state_name || '').toLowerCase().includes(name.toLowerCase()));
const findCa = (name) => ca.features.find(f => (f.properties.name || '').toLowerCase().includes(name.toLowerCase()));

const zonesConfig = [
  // 1. Chiapas (Pacífico)
  {
    id: 'chiapas',
    name: 'Chiapas (Costa Pacífico)',
    shortName: 'Chiapas',
    region: 'Pacífico Sur',
    sea: 'Océano Pacífico',
    feat: findMx('Chiapas'),
    testFn: (lon, lat) => lat <= 16.35 && lon >= -94.20 && lon <= -92.20,
    reverse: false,
  },
  // 2. Oaxaca (Pacífico)
  {
    id: 'oaxaca',
    name: 'Oaxaca (Costa Pacífico)',
    shortName: 'Oaxaca',
    region: 'Pacífico Sur',
    sea: 'Océano Pacífico',
    feat: findMx('Oaxaca'),
    testFn: (lon, lat) => lat <= 16.55 && lon >= -98.60 && lon <= -94.00,
    reverse: false,
  },
  // 3. Guerrero (Pacífico)
  {
    id: 'guerrero',
    name: 'Guerrero (Costa Pacífico)',
    shortName: 'Guerrero',
    region: 'Pacífico Sur',
    sea: 'Océano Pacífico',
    feat: findMx('Guerrero'),
    testFn: (lon, lat) => lat <= 18.05 && lon >= -102.30 && lon <= -98.45,
    reverse: false,
  },
  // 4. Michoacán (Pacífico)
  {
    id: 'michoacan',
    name: 'Michoacán (Costa Pacífico)',
    shortName: 'Michoacán',
    region: 'Pacífico Centro',
    sea: 'Océano Pacífico',
    feat: findMx('Michoac'),
    testFn: (lon, lat) => lat <= 18.85 && lon >= -103.85 && lon <= -102.10,
    reverse: false,
  },
  // 5. Colima (Pacífico)
  {
    id: 'colima',
    name: 'Colima (Costa Pacífico)',
    shortName: 'Colima',
    region: 'Pacífico Centro',
    sea: 'Océano Pacífico',
    feat: findMx('Colima'),
    testFn: (lon, lat) => lat <= 19.35 && lon >= -104.75 && lon <= -103.60,
    reverse: false,
  },
  // 6. Jalisco (Pacífico)
  {
    id: 'jalisco',
    name: 'Jalisco (Costa Pacífico)',
    shortName: 'Jalisco',
    region: 'Pacífico Centro',
    sea: 'Océano Pacífico',
    feat: findMx('Jalisco'),
    testFn: (lon, lat) => lon <= -104.50 && lat <= 20.75 && lat >= 19.15,
    reverse: false,
  },
  // 7. Nayarit (Pacífico)
  {
    id: 'nayarit',
    name: 'Nayarit (Costa Pacífico)',
    shortName: 'Nayarit',
    region: 'Pacífico Occidente',
    sea: 'Océano Pacífico',
    feat: findMx('Nayarit'),
    testFn: (lon, lat) => lon <= -105.10 && lat >= 20.70 && lat <= 23.00,
    reverse: false,
  },
  // 8. Sinaloa (Pacífico / Golfo de California)
  {
    id: 'sinaloa',
    name: 'Sinaloa (Costa Pacífico)',
    shortName: 'Sinaloa',
    region: 'Pacífico Norte',
    sea: 'Golfo de California / Pacífico',
    feat: findMx('Sinaloa'),
    testFn: (lon, lat) => lon <= -105.70 && lat >= 22.50 && lat <= 26.20,
    reverse: false,
  },
  // 9. Sonora (Golfo de California)
  {
    id: 'sonora',
    name: 'Sonora (Golfo de California)',
    shortName: 'Sonora',
    region: 'Pacífico Norte',
    sea: 'Golfo de California',
    feat: findMx('Sonora'),
    testFn: (lon, lat) => lon <= -109.80 && lat >= 26.30 && lat <= 31.80,
    reverse: false,
  },
  // 10. Baja California Sur (Pacífico)
  {
    id: 'bcs_pacifico',
    name: 'Baja California Sur (Pacífico)',
    shortName: 'BCS Pacífico',
    region: 'Pacífico Norte',
    sea: 'Océano Pacífico',
    feat: findMx('Baja California Sur'),
    testFn: (lon, lat) => lon <= -110.00 && lat >= 22.80 && lat <= 28.00 && (lon <= -111.00 || lat <= 24.50),
    reverse: false,
  },
  // 11. Baja California Sur (Golfo)
  {
    id: 'bcs_golfo',
    name: 'Baja California Sur (Golfo)',
    shortName: 'BCS Golfo',
    region: 'Pacífico Norte',
    sea: 'Golfo de California',
    feat: findMx('Baja California Sur'),
    testFn: (lon, lat) => lon >= -112.50 && lat >= 24.00 && lat <= 28.00,
    reverse: false,
  },
  // 12. Baja California (Pacífico)
  {
    id: 'bc_pacifico',
    name: 'Baja California (Pacífico)',
    shortName: 'BC Pacífico',
    region: 'Pacífico Norte',
    sea: 'Océano Pacífico',
    feat: findMx('Baja California') && mx.features.find(f => f.properties.state_name === 'Baja California'),
    testFn: (lon, lat) => lon <= -114.50 && lat >= 28.00 && lat <= 32.60,
    reverse: false,
  },
  // 13. Tamaulipas (Golfo de México)
  {
    id: 'tamaulipas',
    name: 'Tamaulipas (Golfo de México)',
    shortName: 'Tamaulipas',
    region: 'Golfo de México',
    sea: 'Golfo de México',
    feat: findMx('Tamaulipas'),
    testFn: (lon, lat) => lon >= -98.00 && lat >= 22.20 && lat <= 26.00,
    reverse: false,
  },
  // 14. Veracruz Norte
  {
    id: 'veracruz_norte',
    name: 'Veracruz Norte (Golfo de México)',
    shortName: 'Veracruz Norte',
    region: 'Golfo de México',
    sea: 'Golfo de México',
    feat: findMx('Veracruz'),
    testFn: (lon, lat) => lon >= -97.80 && lat >= 20.30 && lat <= 22.35,
    reverse: false,
  },
  // 15. Veracruz Sur & Centro
  {
    id: 'veracruz_sur',
    name: 'Veracruz Centro-Sur (Golfo de México)',
    shortName: 'Veracruz Sur',
    region: 'Golfo de México',
    sea: 'Golfo de México',
    feat: findMx('Veracruz'),
    testFn: (lon, lat) => lon >= -96.80 && lat >= 18.00 && lat <= 20.30,
    reverse: false,
  },
  // 16. Tabasco (Golfo de México)
  {
    id: 'tabasco',
    name: 'Tabasco (Golfo de México)',
    shortName: 'Tabasco',
    region: 'Golfo de México',
    sea: 'Golfo de México',
    feat: findMx('Tabasco'),
    testFn: (lon, lat) => lat >= 18.15 && lon >= -94.20 && lon <= -92.40,
    reverse: false,
  },
  // 17. Campeche (Golfo de México)
  {
    id: 'campeche',
    name: 'Campeche (Golfo de México)',
    shortName: 'Campeche',
    region: 'Golfo de México',
    sea: 'Golfo de México',
    feat: findMx('Campeche'),
    testFn: (lon, lat) => (lon <= -90.20 && lat >= 18.50 && lat <= 20.90) || (lon <= -91.50 && lat >= 18.30),
    reverse: false,
  },
  // 18. Yucatán (Golfo de México)
  {
    id: 'yucatan',
    name: 'Yucatán (Costa Norte)',
    shortName: 'Yucatán',
    region: 'Península de Yucatán',
    sea: 'Golfo de México / Mar Caribe',
    feat: findMx('Yucat'),
    testFn: (lon, lat) => lat >= 20.80 && lon >= -90.50 && lon <= -87.40,
    reverse: false,
  },
  // 19. Quintana Roo (Caribe Mexicano)
  {
    id: 'quintana_roo',
    name: 'Quintana Roo (Caribe Mexicano)',
    shortName: 'Quintana Roo',
    region: 'Península de Yucatán',
    sea: 'Mar Caribe',
    feat: findMx('Quintana'),
    testFn: (lon, lat) => lon >= -87.90 && lat >= 18.10 && lat <= 21.60,
    reverse: false,
  },
  // 20. Guatemala (Pacífico)
  {
    id: 'guatemala',
    name: 'Guatemala (Costa Pacífico)',
    shortName: 'Guatemala',
    region: 'Centroamérica',
    sea: 'Océano Pacífico',
    feat: findCa('Guatemala'),
    testFn: (lon, lat) => lat <= 14.60 && lon >= -92.30 && lon <= -90.00,
    reverse: false,
  },
  // 21. El Salvador (Pacífico)
  {
    id: 'el_salvador',
    name: 'El Salvador (Costa Pacífico)',
    shortName: 'El Salvador',
    region: 'Centroamérica',
    sea: 'Océano Pacífico',
    feat: findCa('El Salvador'),
    testFn: (lon, lat) => lat <= 13.90 && lon >= -90.15 && lon <= -87.70,
    reverse: false,
  },
  // 22. Honduras (Golfo de Fonseca)
  {
    id: 'honduras_pacifico',
    name: 'Honduras (Golfo de Fonseca)',
    shortName: 'Honduras Pacífico',
    region: 'Centroamérica',
    sea: 'Golfo de Fonseca',
    feat: findCa('Honduras'),
    testFn: (lon, lat) => lat <= 13.50 && lon >= -87.85 && lon <= -87.25,
    reverse: false,
  },
  // 23. Belice (Caribe)
  {
    id: 'belice',
    name: 'Belice (Costa Caribe)',
    shortName: 'Belice',
    region: 'Centroamérica',
    sea: 'Mar Caribe',
    feat: findCa('Belize'),
    testFn: (lon, lat) => lon >= -88.80 && lat >= 15.80 && lat <= 18.50,
    reverse: false,
  },
  // 24. Nicaragua (Pacífico)
  {
    id: 'nicaragua',
    name: 'Nicaragua (Costa Pacífico)',
    shortName: 'Nicaragua',
    region: 'Centroamérica',
    sea: 'Océano Pacífico',
    feat: findCa('Nicaragua'),
    testFn: (lon, lat) => lat <= 13.00 && lon >= -87.70 && lon <= -85.60,
    reverse: false,
  },
];

const resultZones = [];

for (const z of zonesConfig) {
  const poly = getMainPoly(z.feat);
  let coast = extractContiguousCoast(poly, z.testFn);
  if (z.reverse) coast.reverse();

  // Calculate bounding box and center
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  coast.forEach(([lon, lat]) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;

  resultZones.push({
    id: z.id,
    name: z.name,
    shortName: z.shortName,
    region: z.region,
    sea: z.sea,
    pointsCount: coast.length,
    bbox: [minLon, minLat, maxLon, maxLat],
    center: [centerLon, centerLat],
    coordinates: coast,
  });

  console.log(`[Zone: ${z.id}] ${z.shortName}: ${coast.length} points extracted.`);
}

const outputPath = path.resolve('desing/map/coastal-zones.json');
fs.writeFileSync(outputPath, JSON.stringify(resultZones, null, 2), 'utf8');
console.log(`\nSuccessfully written ${resultZones.length} coastal zones to ${outputPath}`);
