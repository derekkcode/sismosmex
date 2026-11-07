# sismosmex

## Pruebas del detector

Ejecuta `npm test` para las pruebas de regresión del detector y `npm run build`
para verificar la compilación del cliente. Las pruebas utilizan señales sintéticas
y no modifican MongoDB ni los perfiles de ruido.

Estas pruebas no sustituyen la validación con registros sísmicos reales,
estaciones operativas y una revisión sismológica antes de usar el sistema para
alertas.

La ventana STA se mantiene entre paquetes y el piso de aceleración se aplica en
unidades físicas, independientemente de las cuentas de cada instrumento. La
localización sigue exigiendo seis sitios independientes y las comprobaciones de
apertura, residuo y tiempos diferenciales existentes. Los eventos muy lejanos o
con estaciones solo de un lado pueden seguir sin localizarse correctamente;
el estimador de magnitud excluye estaciones situadas a más de 320 km del
epicentro estimado. Las pruebas sintéticas no certifican la cobertura ni la
precisión de magnitud.
