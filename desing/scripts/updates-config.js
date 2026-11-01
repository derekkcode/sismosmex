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
          ],
          translations: {
            en: [
              "New high-precision real-time seismological engine with optimized hypocentral inversion.",
              "Spherical 1D travel-time model (IASP91 / AK135) with Earth curvature and Moho refraction (Pg and Pn phases).",
              "Predictive S-wave association using the Wadati relation (Vp/Vs = 1.732) and instant physical confirmation.",
              "Dynamic ShakeMap with concentric Mercalli intensity isoseismals displayed in real time on the map.",
              "Mwp proxy estimator to avoid magnitude saturation in large earthquakes.",
              "Continuous spatial sampling using Vogel's Sunflower Spiral distribution (Golden Angle) to remove grid bias.",
              "Robust Pseudo-Huber loss function, immune to network delays, telemetry fluctuations and data anomalies.",
              "Dynamic scaling of seismic clusters (Levels 1, 2 and 3) with sequential emission of continuous refinement reports.",
              "Robust statistical estimation of the origin time t0 using the median.",
              "New adaptive interface for mobile phones with split screen (interactive map and bottom dock).",
              "Simplified mobile navigation with direct access to Information and Real-Time.",
              "Dual mobile view with intensity panel and seismic history shown at the same time.",
              "Automatic camera focus and framing when selecting any earthquake from the history on mobile phones.",
              "Improved zoom level and precise centering for international seismic events in the Americas.",
              "Sensitivity optimization and anti-noise filtering for the institutional seismic network."
            ],
            ja: [
              "震源インバージョンを最適化した、リアルタイムの新しい高精度地震解析エンジン。",
              "地球の曲率とモホ面屈折（Pg・Pn相）を考慮した球対称1次元走時モデル（IASP91 / AK135）。",
              "ワダティ関係（Vp/Vs = 1.732）によるS波の予測的関連付けと、即時の物理的確認。",
              "リアルタイムで地図上にメルカリ震度の等震度線を表示する動的ShakeMap。",
              "大地震での規模の飽和を防ぐためのMwp代理推定器。",
              "Vogelのサンフラワー・スパイラル分布（黄金角）による連続的な空間サンプリングで、グリッドの偏りを除去。",
              "ネットワーク遅延、テレメトリの変動、データ異常に強いロバストなPseudo-Huber損失関数。",
              "地震クラスタのスケーリング（レベル1・2・3）と、継続的な精査レポートの逐次発行。",
              "中央値を用いた、発生時刻t0の統計的にロバストな推定。",
              "分割画面（対話型地図と下部ドック）を備えた、スマートフォン向けの新しい適応型インターフェース。",
              "「情報」とリアルタイム表示へ直接アクセスできる、簡素化されたモバイルナビゲーション。",
              "スマートフォンで、震度パネルと地震履歴を同時に表示するデュアル表示。",
              "スマートフォンで履歴から地震を選択すると、カメラが自動的にフォーカスと位置調整を行います。",
              "アメリカ大陸の国際地震イベントに対する、ズームレベルと中心合わせの精度向上。",
              "機関の地震観測網向けに、感度の最適化とノイズ除去フィルタを改善。"
            ]
          }
        }
      ]
    }
  ]
};
