<template>
  <div :class="['alert-banner-box', { 'warning-state': isWarning }]">
    <div class="alert-banner-header">
      <div class="title-group">
        <span class="status-pulse-dot"></span>
        <span>{{ title }}</span>
      </div>
      <span :class="['intensity-capsule', `int-${intensity}`]">{{ romanIntensity }}</span>
    </div>

    <div class="alert-banner-body">
      <div class="alert-hero-row">
        <div class="alert-hero-magnitude">M {{ magnitude.toFixed(1) }}</div>
        <div class="alert-hero-pga">{{ pga.toFixed(1) }} Gal</div>
      </div>

      <div class="alert-location-text">{{ location }}</div>

      <div class="alert-meta-grid">
        <div>PROFUNDIDAD: <span class="meta-bold">{{ depth }} km</span></div>
        <div>FASE: <span class="meta-phase">{{ activePhase }}</span></div>
      </div>

      <div class="wave-timer-bar">
        <span>Arribo Onda P:</span>
        <span class="wave-timer-val">{{ timerP }}s</span>
      </div>

      <div class="wave-timer-bar">
        <span>Arribo Onda S:</span>
        <span class="wave-timer-val s-wave">{{ timerS }}s</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    magnitude?: number;
    pga?: number;
    location?: string;
    depth?: number;
    intensity?: number;
    activePhase?: string;
    timerP?: number;
    timerS?: number;
    isWarning?: boolean;
  }>(),
  {
    title: 'Sismo en progreso',
    magnitude: 7.2,
    pga: 68.4,
    location: '15 km al Sureste de Acapulco, Gro',
    depth: 15,
    intensity: 7,
    activePhase: 'Onda S (Corte)',
    timerP: 18,
    timerS: 42,
    isWarning: false,
  }
);

const romanMap = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const romanIntensity = computed(() => romanMap[props.intensity] || 'VII');
</script>

<style scoped>
.status-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
  display: inline-block;
  box-shadow: 0 0 6px #ffffff;
}

.meta-bold {
  color: #ffffff;
  font-weight: 800;
}

.meta-phase {
  color: #ef4444;
  font-weight: 800;
}
</style>
