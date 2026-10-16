<template>
  <div class="waves-canvas-wrapper">
    <canvas ref="canvasEl"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    mode?: 'NORMAL' | 'ALERT_M72' | 'PRE_EST';
    magnitude?: number;
    epicenterX?: number; // 0 a 1
    epicenterY?: number; // 0 a 1
  }>(),
  {
    mode: 'ALERT_M72',
    magnitude: 7.2,
    epicenterX: 0.53,
    epicenterY: 0.76,
  }
);

const canvasEl = ref<HTMLCanvasElement | null>(null);
let animId: number | null = null;
let pRadius = 0;
let sRadius = 0;
let simTime = 0;

function loop() {
  simTime += 0.016;
  if (!canvasEl.value) return;

  const canvas = canvasEl.value;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (props.mode === 'ALERT_M72' || props.mode === 'PRE_EST') {
    const cx = props.epicenterX * w;
    const cy = props.epicenterY * h;

    pRadius = (pRadius + 2.8) % (w * 0.8);
    sRadius = (sRadius + 1.6) % (w * 0.8);

    // Radar Ping en el Epicentro
    const pingCycle = (simTime % 1.6) / 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, pingCycle * 50, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(239, 68, 68, ${1 - pingCycle})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Frente de Onda P (Azul)
    ctx.beginPath();
    ctx.arc(cx, cy, pRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.04)';
    ctx.fill();

    // Frente de Onda S (Rojo / Destructivo)
    ctx.beginPath();
    ctx.arc(cx, cy, sRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#dc2626';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.fillStyle = 'rgba(220, 38, 38, 0.1)';
    ctx.fill();
    ctx.shadowBlur = 0;

    // Cruz de Epicentro
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 8);
    ctx.lineTo(cx + 8, cy + 8);
    ctx.moveTo(cx + 8, cy - 8);
    ctx.lineTo(cx - 8, cy + 8);
    ctx.stroke();
  }

  animId = requestAnimationFrame(loop);
}

onMounted(() => {
  animId = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  if (animId) cancelAnimationFrame(animId);
});

watch(() => props.mode, () => {
  pRadius = 0;
  sRadius = 0;
});
</script>

<style scoped>
.waves-canvas-wrapper {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  pointer-events: none;
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
