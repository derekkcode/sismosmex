<template>
  <div v-if="isOpen" class="station-monitor-modal">
    <!-- Barra de Título -->
    <div class="gq-window-titlebar">
      <div class="gq-titlebar-title">
        <span class="gq-badge-ico">GQ</span>
        <span>{{ stationCode }} - {{ stationName }}</span>
        <span :class="['gq-status-pill', { triggered: isTriggered }]">
          {{ isTriggered ? 'DISPARADA (PGA ALTO)' : 'EN VIVO' }}
        </span>
      </div>
      <div class="gq-window-controls">
        <button class="gq-win-btn close-btn" @click="$emit('close')">✕</button>
      </div>
    </div>

    <!-- Tira de Telemetría -->
    <div class="gq-telemetry-strip">
      <div class="gq-telemetry-card">
        <span class="gq-telemetry-label">PGA (Gal)</span>
        <span class="gq-telemetry-val pga-val">{{ pga.toFixed(2) }} Gal</span>
      </div>
      <div class="gq-telemetry-card">
        <span class="gq-telemetry-label">PGV (cm/s)</span>
        <span class="gq-telemetry-val">{{ pgv.toFixed(2) }} cm/s</span>
      </div>
      <div class="gq-telemetry-card">
        <span class="gq-telemetry-label">STA / LTA Ratio</span>
        <span class="gq-telemetry-val" style="color: #ef4444;">{{ staRatio.toFixed(2) }}</span>
      </div>
      <div class="gq-telemetry-card">
        <span class="gq-telemetry-label">Latencia de Red</span>
        <span class="gq-telemetry-val" style="color: #10b981;">{{ latency.toFixed(2) }} s</span>
      </div>
    </div>

    <!-- Canales de Onda (Osciloscopio) -->
    <div class="gq-graphs-area">
      <div class="gq-channel-block">
        <div class="gq-channel-header">
          <span>CANAL BHZ (COMPONENTE VERTICAL)</span>
          <span class="chan-tag">Raw Data [±18,500 Cnt]</span>
        </div>
        <div class="gq-canvas-stage">
          <canvas ref="canvasZ"></canvas>
        </div>
      </div>

      <div class="gq-channel-block">
        <div class="gq-channel-header">
          <span>CANAL BHN (FILTRO PASABANDA 0.1 - 5.0 Hz)</span>
          <span class="chan-tag">Velocity [±4.2 cm/s]</span>
        </div>
        <div class="gq-canvas-stage">
          <canvas ref="canvasN"></canvas>
        </div>
      </div>

      <div class="gq-channel-block">
        <div class="gq-channel-header">
          <span>DETECTOR STA / LTA (RATIO ENERGÉTICO)</span>
          <span class="chan-tag" style="color: #f59e0b;">Umbral Disparo: 3.20</span>
        </div>
        <div class="gq-canvas-stage">
          <canvas ref="canvasSTA"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

const props = withDefaults(
  defineProps<{
    isOpen?: boolean;
    stationCode?: string;
    stationName?: string;
    pga?: number;
    pgv?: number;
    staRatio?: number;
    latency?: number;
    isTriggered?: boolean;
  }>(),
  {
    isOpen: true,
    stationCode: 'IG LVIG',
    stationName: 'Las Vigas, Veracruz',
    pga: 48.25,
    pgv: 3.82,
    staRatio: 8.64,
    latency: 0.84,
    isTriggered: true,
  }
);

defineEmits<{
  (e: 'close'): void;
}>();

const canvasZ = ref<HTMLCanvasElement | null>(null);
const canvasN = ref<HTMLCanvasElement | null>(null);
const canvasSTA = ref<HTMLCanvasElement | null>(null);

let animId: number | null = null;
const waveDataZ = new Float32Array(250);
const waveDataN = new Float32Array(250);
const waveDataSTA = new Float32Array(250);
let time = 0;

function loop() {
  time += 0.05;
  const amp = props.isTriggered ? 0.75 : 0.08;

  for (let i = 0; i < 249; i++) {
    waveDataZ[i] = waveDataZ[i + 1];
    waveDataN[i] = waveDataN[i + 1];
    waveDataSTA[i] = waveDataSTA[i + 1];
  }

  const noiseZ = (Math.random() - 0.5) * 0.15;
  const noiseN = (Math.random() - 0.5) * 0.15;
  waveDataZ[249] = Math.sin(time * 5.2) * amp + noiseZ;
  waveDataN[249] = Math.cos(time * 4.6) * amp + noiseN;
  waveDataSTA[249] = props.isTriggered ? 6.5 + Math.sin(time * 3) * 2.0 : 1.0 + Math.random() * 0.3;

  if (canvasZ.value) drawWave(canvasZ.value, waveDataZ, '#38bdf8');
  if (canvasN.value) drawWave(canvasN.value, waveDataN, '#34d399');
  if (canvasSTA.value) drawSta(canvasSTA.value, waveDataSTA, '#f59e0b', 3.2);

  animId = requestAnimationFrame(loop);
}

function drawWave(canvas: HTMLCanvasElement, data: Float32Array, color: string) {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const midY = h / 2;

  ctx.fillStyle = '#060b13';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const y = midY - data[i] * (h * 0.4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSta(canvas: HTMLCanvasElement, data: Float32Array, color: string, threshold: number) {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#060b13';
  ctx.fillRect(0, 0, w, h);

  const threshY = h - (threshold / 10.0) * (h * 0.85);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, threshY);
  ctx.lineTo(w, threshY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const norm = Math.min(10, data[i]);
    const y = h - (norm / 10.0) * (h * 0.85);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

onMounted(() => {
  animId = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  if (animId) cancelAnimationFrame(animId);
});
</script>

<style scoped>
.gq-badge-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: #38bdf8;
  color: #08111c;
  border-radius: 3px;
  font-weight: 900;
  font-size: 11px;
}
</style>
