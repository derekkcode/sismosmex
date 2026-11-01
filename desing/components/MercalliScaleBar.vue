<template>
  <div class="mercalli-container">
    <div class="mercalli-title">Escala de Intensidad Sísmica</div>
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
  { level: 1, roman: '1', label: '1 - Muy débil' },
  { level: 2, roman: '2', label: '2 - Débil' },
  { level: 3, roman: '3', label: '3 - Leve' },
  { level: 4, roman: '4', label: '4 - Moderado' },
  { level: 5, roman: '5', label: '5 - Fuerte' },
  { level: 6, roman: '6', label: '6 - Muy fuerte' },
  { level: 7, roman: '7', label: '7 - Severo' },
  { level: 8, roman: '8', label: '8 - Destructivo' },
  { level: 9, roman: '9', label: '9 - Ruinoso' },
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
