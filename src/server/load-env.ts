import fs from 'fs';
import path from 'path';

// Carga variables de .env (si existe) sin dependencias extra. No sobrescribe variables ya definidas.
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn('[Env] No se pudo leer .env:', err);
  }
}
