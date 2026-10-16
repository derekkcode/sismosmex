<template>
  <div class="mercalli-container">
    <div class="mercalli-title">Escala de Intensidad Sísmica (Mercalli)</div>
    <div class="mercalli-scale-bar">
      <div
        v-for="step in steps"
        :key="step.roman"
        :class="['mercalli-step', 'intensity-capsule', `int-${step.level}`, { active: currentIntensity === step.level }]"
        :title="step.label"
        @click="$emit('select', step.level)"
      >
        {{ step.roman }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    currentIntensity?: number;
  }>(),
  {
    currentIntensity: 7,
  }
);

defineEmits<{
  (e: 'select', level: number): void;
}>();

const steps = [
  { level: 1, roman: 'I', label: 'I - Muy débil' },
  { level: 2, roman: 'II', label: 'II - Débil' },
  { level: 3, roman: 'III', label: 'III - Leve' },
  { level: 4, roman: 'IV', label: 'IV - Moderado' },
  { level: 5, roman: 'V', label: 'V - Fuerte' },
  { level: 6, roman: 'VI', label: 'VI - Muy fuerte' },
  { level: 7, roman: 'VII', label: 'VII - Severo' },
  { level: 8, roman: 'VIII', label: 'VIII - Destructivo' },
  { level: 9, roman: 'IX', label: 'IX - Ruinoso' },
];
</script>

<style scoped>
.mercalli-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mercalli-title {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
