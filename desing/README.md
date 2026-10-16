# Sistema de Diseño y Animaciones del Monitor Sísmico (Carpeta `desing`)

Este directorio contiene **todo el diseño visual, maquetación, estilos, animaciones y componentes del monitor sísmico** (estilo *SismoMex* y *GlobalQuake*), desacoplado completamente de cualquier lógica de servidor o backend (sin sockets TCP SeedLink, sin daemons de Python, sin bots de Telegram y sin base de datos).

---

## 📁 Estructura de la Carpeta `desing/`

```text
desing/
├── index.html                     # Demostrador interactivo completo y autónomo del monitor
├── tokens.json                    # Variables de diseño (colores, sombras, radios, tiempos de animación)
├── audio/                         # Sonidos de alerta y efectos sonoros del monitor
│   ├── desconfirmacion.mp3        # Sonido de descarte o cancelación de alerta
│   ├── eqk_detected.mp3           # Alerta de sismo detectado
│   ├── estimacion.mp3             # Sonido de pre-estimación en cálculo
│   ├── extreme.mp3                # Sonido de alerta sísmica severa / extrema
│   ├── meow.mp3                   # Sonido especial de notificación
│   ├── mm1.mp3, mm2.mp3           # Sonidos de escala instrumental Mercalli I y II
│   ├── mm_3_4.mp3, mm_5_6.mp3     # Sonidos de intensidades moderadas a fuertes
│   ├── mm_7_8.mp3, mm_9_10.mp3    # Sonidos de intensidades severas a ruinosas
│   ├── pip.mp3                    # Tic / pulso acústico de cuenta regresiva
│   └── reporte.mp3                # Sonido de nuevo reporte emitido
├── map/                           # Capas cartográficas GeoJSON de México y países vecinos
│   ├── mx_states.json             # Polígonos de los 32 estados de la República Mexicana
│   ├── centroamerica.json         # Polígonos limítrofes de Centroamérica
│   ├── usa.json, cuba.json, etc.  # Cartografía regional complementaria
├── styles/
│   ├── animations.css             # Todas las animaciones keyframes (radar ping, ondas expansivas, pulso)
│   ├── intensity.css              # Escala de intensidad Mercalli Modificada (colores I a IX y cápsulas)
│   ├── monitor.css                # Estilos generales del monitor (sidebar, layout de mapa, botones flotantes)
│   ├── station-monitor.css        # Ventana osciloscopio estilo GlobalQuake (canales Z, N, STA/LTA y PGA)
│   └── mobile.css                 # Diseño adaptable móvil (tarjeta flotante inferior, barra táctil)
├── scripts/
│   └── monitor-engine.js          # Motor visual de simulación de ondas concéntricas P y S (Canvas a 60 FPS)
└── components/
    ├── EewAlertBanner.vue         # Componente Vue del banner "Sismo en progreso" con temporizadores
    ├── MercalliScaleBar.vue       # Barra de selección de intensidad Mercalli (I a IX)
    ├── StationWaveformMonitor.vue # Ventana oscilograma de 3 componentes en tiempo real
    ├── SeismicWavesCanvas.vue     # Canvas de propagación de ondas y radar ping
    └── ReportListCard.vue         # Lista de reportes y catálogo de sismos registrados
```

---

## 🎨 Características de Diseño Incluidas

### 1. Animaciones y Efectos Visuales (`styles/animations.css`)
* **`radar-ping`**: Efecto de eco de radar expansivo en el epicentro sísmico.
* **`wave-expand`**: Ondas concéntricas físicas:
  * **Onda P**: Anillo azul celeste discontinuo de avance rápido (~6.2 km/s).
  * **Onda S**: Anillo rojo de corte destructivo con resplandor difuso (`box-shadow` / `blur`) de avance medio (~3.55 km/s).
* **`alertBtnPulse`**: Pulso de color carmesí para botones y estados de emergencia activa.
* **`pulseBadge`**: Animación de palpitación para avisos y contadores numéricos.
* **`station-breathe`**: Respiración y halo de las estaciones sísmicas según su aceleración (Gal).
* **`mercalli-shimmer`**: Resplandor dinámico en la barra de intensidad Mercalli.

### 2. Monitor de Estación GlobalQuake (`styles/station-monitor.css`)
* Ventana flotante estilo estación sismológica.
* 3 canales osciloscópicos animados:
  * **BHZ (Vertical)**: Trazado sintético de aceleración bruta.
  * **BHN (Horizontal Norte-Sur)**: Filtro pasabanda 0.1–5.0 Hz.
  * **STA / LTA**: Ratio energético con línea de umbral de disparo roja punteada.
* Tira superior de telemetría: PGA en Gal, PGV en cm/s, Ratio STA/LTA y latencia.

### 3. Escala Mercalli Instrumental (`styles/intensity.css`)
* Paleta normalizada de 10 niveles (I a IX) con alto contraste WCAG AA.
* Cápsulas de estado y badges con efecto de profundidad y colores oficiales.

### 4. Modo Móvil Adaptativo (`styles/mobile.css`)
* Tarjeta flotante táctil inferior con datos de magnitud, aceleración pico y hora.
* Barra de navegación inferior de 4 pestañas: *Sismos*, *Tiempo Real*, *Alertas* y *Ajustes*.

---

## 🚀 Cómo Usar o Probar el Diseño

1. **Abrir directamente en el navegador**:
   Abre el archivo `desing/index.html` con cualquier navegador web moderno o live server. No requiere compilación ni servidores backend.

2. **Probar los diferentes estados en vivo**:
   En la esquina superior derecha encontrarás el panel interactivo:
   * **Sismo M7.2**: Muestra la alerta roja de sismo en progreso, ondas P y S en el mapa, y dispara el osciloscopio.
   * **Pre-Estimación**: Muestra la advertencia en color ámbar de detección temprana.
   * **Modo Normal**: Muestra la red en reposo con micro-vibraciones basales.
   * **Osciloscopio**: Abre/cierra la ventana de sismograma de estación.
   * **Vista Móvil**: Alterna la simulación de pantalla móvil con tarjeta flotante inferior.

3. **Integración en proyectos Vue / Vite**:
   Los componentes en `desing/components/` son SFCs (Single File Components) listos para importar sin requerir ningún módulo del backend.
