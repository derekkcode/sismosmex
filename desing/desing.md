# Manual de Arquitectura y Diseño Visual del Monitor Sísmico (`desing.md`)

Este documento detalla la **función técnica, matemática, visual y estructural** de cada uno de los archivos, estilos, animaciones, componentes y sonidos incluidos en el sistema de diseño del monitor sísmico (**SismoMex / GlobalQuake**), desarrollado de forma 100% independiente del backend.

---

## 1. Estructura General de Archivos

```text
desing/
├── index.html                     # Demostrador interactivo completo y visor visual autónomo
├── tokens.json                    # Diccionario central de variables y tokens de diseño
├── desing.md                      # Este manual explicativo detallado
├── README.md                      # Guía rápida de uso e integración
├── audio/                         # Banco de efectos de sonido y alertas sísmicas
├── map/                           # Capas cartográficas GeoJSON de los 32 estados y fronteras
├── styles/                        # Hojas de estilo CSS modulares y desacopladas
├── scripts/                       # Motor gráfico en Canvas a 60 FPS sin backend
└── components/                    # Componentes modulares en Vue (SFC)
```

---

## 2. Descripción Funcional de Archivos y Módulos

### 📐 `tokens.json` — Diccionario Central de Tokens
* **Función:** Define los valores canónicos del sistema de diseño para asegurar coherencia visual.
* **Secciones:**
  - **`colors.background`**: Colores profundos de baja fatiga visual (`#080f19` para el fondo del mapa, `#08111c` para barra lateral, `#121e2f` para tarjetas).
  - **`colors.alerts`**: Colores de semaforización internacional de emergencias (Rojo crítico `#dc2626`, Ámbar `#f59e0b`, Normal `#10b981`).
  - **`colors.mercalliScale`**: Mapeo cromático de los 10 niveles de la escala Mercalli Modificada (MMI 0 a IX).
  - **`colors.waves`**: Parámetros físicos de propagación de ondas sísmicas (Onda P en azul `#38bdf8` a 6.2 km/s y Onda S en rojo `#ef4444` a 3.55 km/s).
  - **`animations`**: Tiempos de duración y curvas Bezier cúbicas de aceleración.

---

### 🖥️ `index.html` — Demostrador Interactivo Autónomo
* **Función:** Es la vista previa principal ejecutable en cualquier navegador sin necesidad de servidores, bases de datos ni conexión a internet.
* **Características y Paneles:**
  1. **Simulador de Escenarios Sísmicos:**
     - **Sismo M7.2:** Dispara el estado de emergencia, propaga ondas P y S en el mapa, agita las estaciones cercanas y activa el osciloscopio en tiempo real.
     - **Pre-Estimación:** Muestra el banner ámbar de detección preliminar antes de la confirmación final.
     - **Modo Normal:** Simula la red sísmica en reposo con micro-vibraciones basales.
  2. **Osciloscopio GlobalQuake:** Ventana flotante interactiva con 3 canales sísmicos sincronizados.
  3. **Simulador de Dispositivos Móviles:** Alterna instantáneamente entre la vista de escritorio y la interfaz táctil con tarjeta flotante inferior.
  4. **Probador de Audio:** Botones dedicados para reproducir los 13 sonidos del monitor.

---

### 🎨 Hojas de Estilo (`styles/`)

#### 1. `styles/animations.css` — Motor de Animaciones Keyframes
* **`radar-ping`**: Expande un halo concéntrico en el epicentro con desvanecimiento alfa (`opacity: 0.95 -> 0`) para representar el origen de la ruptura telúrica.
* **`alertBtnPulse`**: Genera un resplandor pulsante (`box-shadow: 0 0 12px 2px rgba(220, 38, 38, 0.6)`) para alertar al operador sin saturar la pantalla.
* **`pulseBadge`**: Escalado suave (`scale(1.15)`) para contadores de sismos activos y badges prioritarios.
* **`station-breathe`**: Efecto de respiración suave sobre estaciones en reposo para indicar que la estación está transmitiendo datos.
* **`station-alert-flash`**: Agrandamiento (`scale(1.4)`) y halo de advertencia cuando una estación registra aceleraciones elevadas (> 5 Gal).
* **`banner-emergency`**: Alternancia cromática de fondo entre rojo `#dc2626` y rojo oscuro `#991b1b` para el banner "Sismo en progreso".
* **`mercalli-shimmer`**: Resplandor sutil en la barra de intensidades Mercalli.

#### 2. `styles/intensity.css` — Escala Mercalli Modificada (MMI)
* **Función:** Controla la apariencia de las cápsulas y números romanos de intensidad (I a IX).
* **Niveles y Códigos de Color:**
  - **0 (Sin percepción)**: `#1e3a5f`
  - **I (Muy débil)**: `#2f95ba` (Azul pizarra / Acero)
  - **II (Débil)**: `#249d8c` (Turquesa mate)
  - **III (Leve)**: `#2e8540` (Verde bosque)
  - **IV (Moderado)**: `#738b28` (Verde oliva / musgo)
  - **V (Algo fuerte)**: `#c98a12` (Ámbar cálido mate)
  - **VI (Fuerte)**: `#cb5a1d` (Terracota / Naranja cálido)
  - **VII (Muy fuerte)**: `#b82e2e` (Rojo mate)
  - **VIII (Destructivo)**: `#8e1b1b` (Rojo oscuro ladrillo)
  - **IX (Violento)**: `#6b143a` (Carmesí oscuro / Borgoña)
  - **X+ (Extremo)**: `#4c1d72` (Púrpura sobrio)
* **Contraste y estilo:** Colores sólidos, mate y sobrios (sin brillos, neones o halos fluorescentes). Cada nivel cumple con WCAG AA.

#### 3. `styles/monitor.css` — Estilos del Layout Principal
* **Barra Lateral (`.monitor-sidebar`):**
  - Contiene el banner de emergencia con magnitud destacada (`font-size: 32px; font-weight: 900;`), aceleración pico (PGA en Gal), fase activa y contadores de arribo a Ciudad de México.
  - Lista deslizable con scroll estilizado para el catálogo histórico de sismos.
* **Área del Mapa (`.monitor-map-stage`):**
  - Contenedor de ancho completo para el Canvas de ondas.
  - Barras flotantes de herramientas con botones de zoom, recentrado e historial.

#### 4. `styles/station-monitor.css` — Monitor de Estación (Osciloscopio)
* **Ventana Flotante Estilo Sismológico:**
  - **Barra Superior de Título:** Código de estación (ej. `IG LVIG - Las Vigas, Veracruz`), indicador de estado en tiempo real y botones de ventana.
  - **Tira de Telemetría:** 4 tarjetas métricas con PGA (Gal), PGV (cm/s), Ratio STA/LTA y Latencia de transmisión.
  - **3 Canales de Señal:**
    1. **BHZ:** Canal vertical sin filtrar (Raw counts).
    2. **BHN:** Canal horizontal Norte-Sur con filtro pasabanda sismológico (0.1 - 5.0 Hz).
    3. **STA/LTA:** Canal del algoritmo de detección por promedio de energía a corto y largo plazo con línea de disparo roja punteada (`threshold = 3.20`).

#### 5. `styles/mobile.css` — Adaptabilidad para Teléfonos y Tablets
* **Tarjeta Flotante Inferior (`.mobile-monitor-card`):** Muestra de forma compacta el estado de alarma, magnitud y aceleración sin obstruir la vista del mapa.
* **Barra de Navegación Inferior (`.mobile-bottom-bar`):** 4 botones táctiles de 44px para acceso rápido a *Sismos*, *Tiempo Real*, *Alertas* y *Ajustes*.

---

### 🕹️ `scripts/monitor-engine.js` — Motor Gráfico de Simulación Física
* **Función:** Renderiza el mapa y la propagación de ondas sísmicas a 60 cuadros por segundo mediante HTML5 Canvas, sin requerir bibliotecas externas ni conexión de red.
* **Lógica Interna:**
  - **Propagación de Ondas:** Modela el crecimiento radial de la Onda P ($v_p \approx 6.2\text{ km/s}$) y la Onda S ($v_s \approx 3.55\text{ km/s}$).
  - **Atenuación por Distancia:** Calcula la aceleración en cada estación en función de la distancia euclidiana al hipocentro:
    $$\text{PGA}_{estación} = f(\text{Magnitud}) \times \text{Atenuación}(d)$$
  - **Respuesta de Estaciones:** Si el frente de onda alcanza una estación, el halo se expande y cambia de color según la escala Mercalli calculada dinámicamente.
  - **Mapa Base:** Traza las costas de México y la Trinchera Mesoamericana (zona de subducción del Pacífico).

---

### 🔊 Banco de Sonidos (`audio/`)

| Archivo | Evento que Representa |
|---|---|
| `eqk_detected.mp3` | **Detección Inicial:** Sonido emitido en el instante que la primera estación confirma un evento sísmico. |
| `extreme.mp3` | **Alerta Sísmica Severa:** Alarma de alta intensidad para sismos de magnitud destructiva ($M \ge 6.0$). |
| `estimacion.mp3` | **Pre-Estimación:** Tono de cálculo preliminar mientras se determinan magnitud y epicentro. |
| `reporte.mp3` | **Boletín / Reporte Oficial:** Sonido cuando se publica una actualización de parámetros oficiales. |
| `desconfirmacion.mp3` | **Descarte de Evento:** Tono cuando una perturbación local o ruido de sensor es descartado. |
| `pip.mp3` | **Pulso de Tiempo:** Tic acústico por segundo durante la cuenta regresiva de arribo de onda S. |
| `mm1.mp3`, `mm2.mp3` | Tonos para intensidades instrumentales muy débiles a leves (Mercalli I - II). |
| `mm_3_4.mp3`, `mm_5_6.mp3` | Tonos para intensidades moderadas a fuertes (Mercalli III - VI). |
| `mm_7_8.mp3`, `mm_9_10.mp3` | Tonos de emergencia crítica para intensidades severas a ruinosas (Mercalli VII - X). |
| `meow.mp3` | Tono de notificación auxiliar / prueba. |

---

### 🧩 Componentes Modulares en Vue (`components/`)

1. **`EewAlertBanner.vue`**:
   - Componente Vue desacoplado para mostrar la tarjeta de sismo en progreso con cálculo de tiempo restante de arribo y estado de alerta.
2. **`MercalliScaleBar.vue`**:
   - Barra horizontal interactiva con los 9 niveles de intensidad Mercalli que emite eventos `@select(level)`.
3. **`StationWaveformMonitor.vue`**:
   - Componente de ventana osciloscópica con animación continua de los 3 canales sismológicos (Z, N, STA/LTA).
4. **`SeismicWavesCanvas.vue`**:
   - Capa Canvas independiente y transparente para sobreponer las ondas P y S sobre cualquier mapa.
5. **`ReportListCard.vue`**:
   - Tarjetas de historial de sismos con badges de magnitud coloreados según severidad.

---

## 🚀 Resumen de Funcionamiento

Todo el sistema de diseño en la carpeta `desing/` funciona de manera **totalmente independiente y autónoma**:
- No requiere configuración de servidores Express, Rust Tauri ni Python.
- Los gráficos, oscilogramas y ondas se simulan matemáticamente en el cliente a 60 FPS.
- Se puede abrir `desing/index.html` directamente en cualquier explorador o integrarse en cualquier aplicación web existente.
