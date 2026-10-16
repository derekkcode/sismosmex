/**
 * ============================================================================
 * CONFIGURACIÓN DE ACTUALIZACIONES (ESTILO SIMPLE JQUAKE / KYOSHIN)
 * ============================================================================
 * Página con la versión oficial del monitor v8.6.0
 */

export const UPDATES_CONFIG = {
  title: "ⓘ Información",
  pages: [
    {
      page: 1,
      title: "ⓘ Información",
      versions: [
        {
          version: "v8.6.0",
          changes: [
            "Nuevo motor sismológico de alta precisión en tiempo real con inversión hipocentral optimizada.",
            "Modelo de tiempos de viaje 1D esférico (IASP91 / AK135) con curvatura terrestre y refracción en Moho (fases Pg y Pn).",
            "Asociación predictiva de onda S con relación de Wadati (Vp/Vs = 1.732) y confirmación física instantánea.",
            "Visualización de ShakeMap dinámico con isoseistas concéntricas de intensidad Mercalli en tiempo real sobre el mapa.",
            "Estimador proxy Mwp para evitar la saturación de magnitud en terremotos de gran energía.",
            "Muestreo espacial continuo mediante distribución Sunflower Spiral de Vogel (Golden Angle) para eliminación de sesgos de grilla.",
            "Función de pérdida Pseudo-Huber robusta para inmunidad ante retrasos de red, fluctuaciones de telemetría y anomalías de datos.",
            "Escalado dinámico de clusters sísmicos (Niveles 1, 2 y 3) con emisión secuencial de reportes de refinamiento continuo.",
            "Estimación matemática del tiempo de origen t0 mediante mediana estadística robusta.",
            "Nueva interfaz adaptativa para teléfonos móviles con pantalla dividida (mapa interactivo y dock inferior).",
            "Navegación móvil simplificada con acceso directo a Información y Tiempo Real.",
            "Visualización dual en móvil con panel de intensidades e historial sísmico simultáneo.",
            "Enfoque y encuadre automático de cámara al seleccionar cualquier sismo del historial en teléfonos móviles.",
            "Ampliación del nivel de zoom y centrado de precisión para eventos sísmicos internacionales en América.",
            "Optimización de sensibilidad y filtrado anti-ruido para la red sísmica institucional."
          ]
        }
      ]
    }
  ]
};
