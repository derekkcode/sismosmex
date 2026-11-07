# sismosmex

## Detección sísmica (arquitectura GlobalQuake)

El detector ([src/server/seedlink/detector.ts](src/server/seedlink/detector.ts)) sigue el canal de
[GlobalQuake](https://github.com/xspanger3770/GlobalQuake) adaptado a TypeScript. Cada paquete SeedLink pasa por:

1. **Evento por estación** (`gq-analysis.ts`): la componente vertical se filtra (Butterworth orden 3, 2 - 5 Hz) y se
   compara el promedio corto con el de fondo. Un evento nace cuando el cociente supera el umbral (4.75, con las
   condiciones de GlobalQuake) y la llegada P se busca hacia atrás hasta el último instante en calma. No hay pisos de
   PGA ni un número mínimo de estaciones en esta etapa, por lo que un sismo pequeño junto a una sola estación sí
   abre su evento.
2. **Grupos** (`gq-cluster.ts`): los eventos de estaciones vecinas con llegadas P compatibles (`d / 5 km/s + 2.5 s`)
   forman un grupo que crece por cadena y por coincidencia con el hipocentro. Las llegadas S de un sismo ya localizado
   no abren grupos nuevos.
3. **Hipocentro** (`gq-hypocenter.ts`): búsqueda en espiral de Vogel sobre latitud, longitud y profundidad con el modelo
   regional de tiempos de viaje (`travel-time.ts`). Un sismo se declara cuando al menos **4 llegadas son correctas**
   (>= 50 % de las usadas), la cobertura angular y la incertidumbre son aceptables y no faltan llegadas evidentes.
   Con menos de 6 llegadas la profundidad se fija en 10 km. La calidad (S, A, B, C, D) sigue los criterios de
   GlobalQuake.
4. **Magnitud** (`magnitude.ts`): ML de Hutton & Boore (1987) con la amplitud Wood-Anderson sintética de cada estación
   a menos de 320 km (mediana). Contra cinco sismos reales M3.3 - M5.1 (red BC, CICESE, y MX/G/II) la mediana por sismo
   queda entre -0.5 y +0.1 unidades del catálogo; el valor crece conforme llegan las ondas S, por lo que la primera
   magnitud publicada suele ser menor que la final.

### Qué es un sismo confirmado

Un sismo localizado nace **preliminar** y solo pasa a **confirmado** con evidencia explícita; el paso del tiempo no
confirma nada:

| Base | Condición |
| --- | --- |
| `NETWORK` | >= 6 llegadas correctas con calidad S - C, o >= 5 con >= 80 % correctas, RMS <= 0.8 s e incertidumbre <= 50 km |
| `S_WAVE` | en >= 2 sitios independientes el pico de la sacudida cae en la ventana de la onda S esperada y supera 4 veces el ruido previo de la propia estación (con >= 4 sitios en el sismo) |
| `SSN` | el sismo coincide con uno del Servicio Sismológico Nacional (origen y llegadas P compatibles) |

Tres estaciones coherentes solo se muestran como *candidato* (sin epicentro, magnitud ni sonido). Los sismos que el SSN
publica y que la red no pudo localizar por sí sola (uno a tres sitios) se corroboran con el RSS del SSN: si, pasados
90 s, las estaciones tienen una llegada P fuerte (cociente >= 16, a <= 300 km) compatible con el hipocentro del SSN
(+/- 2.5 s + 3 % del tiempo de viaje), el sismo se registra como detectado en esas estaciones y confirmado por el SSN.
Si ninguna estación lo registró, queda constancia en el registro del servidor (M >= 3) para evaluar la cobertura.

## Pruebas

`npm test` ejecuta las pruebas de regresión y `npm run build` verifica la compilación del cliente. Las pruebas no
modifican MongoDB ni los perfiles de ruido.

- Señales sintéticas (`tests/helpers/synthetic-seismograms.mjs`): análisis por estación, agrupamiento, localización,
  confirmación, SSN, cancelación y DSP.
- **Registros reales** (`tests/fixtures`, `tests/real-data.test.mjs`): fragmentos de la componente vertical de la red BC
  (CICESE) obtenidos de los servicios FDSN de EarthScope (datos abiertos), con la sensibilidad real de cada canal.
  Incluyen el sismo M3.3 ml del 27/12/2022 al ESE de Maneadero, B.C., a 16 km de BC.VTX (la situación de un sismo cerca
  de una estación), y 3 minutos de ruido diurno en cinco estaciones ruidosas. Verifican que el sismo se declara a los
  ~18 s con el epicentro a < 15 km, que se confirma con cuatro o más estaciones, que tres estaciones solo dan un
  candidato, que dos estaciones se corroboran con el SSN y que el ruido real no produce eventos.

Estas pruebas no sustituyen la validación continua con estaciones operativas y una revisión sismológica antes de usar
el sistema para alertas.

## Límites conocidos

- Con menos de 4 estaciones coherentes el sismo no se localiza por sí solo: depende de la corroboración del SSN
  (disponible unos minutos después) o de que más estaciones lo registren.
- La profundidad queda fija (10 km) con menos de 6 llegadas y la magnitud solo usa la componente vertical, que suele
  quedar por debajo del ML publicado.
- Las estaciones muy ruidosas (p. ej. Raspberry Shake urbanas) pueden abrir eventos aislados; un sismo falso necesita
  llegadas P compatibles en varias estaciones vecinas.
