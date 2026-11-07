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

Con tres o más sitios independientes y tiempos compatibles, la interfaz puede
mostrar una coincidencia experimental, separada del historial y sin sonido,
epicentro ni magnitud. Puede ser ruido y no confirma un sismo. Una brecha
azimutal mayor de 270° impide declarar una localización de la red; el grupo
puede seguir apareciendo como coincidencia. Esta regla conservadora también
puede impedir la declaración de sismos reales fuera de la red.

Los eventos reales preliminares solo se confirman con datos explícitos del
servidor; el paso del tiempo no los confirma. Para habilitar una estimación
fiable de magnitud a mayor distancia hacen falta registros reales, calibración
regional y validación independiente: no se ha ampliado el límite de 320 km.
