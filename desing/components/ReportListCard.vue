<template>
  <div class="reports-container">
    <div class="history-header-bar">
      <span>SISMOS REGISTRADOS</span>
      <span class="badge-counter">{{ reports.length }} Activos</span>
    </div>

    <div class="history-scroll-list">
      <div
        v-for="rep in reports"
        :key="rep.id"
        :class="['report-item-card', { active: activeId === rep.id }]"
        @click="$emit('select', rep)"
      >
        <div :class="['report-mag-badge', getMagClass(rep.mag)]">
          {{ rep.mag.toFixed(1) }}
        </div>
        <div class="report-info">
          <div class="report-loc">{{ rep.loc }}</div>
          <div class="report-meta">
            <span>{{ rep.time }}</span>
            <span>•</span>
            <span>Prof: {{ rep.depth }} km</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface ReportItem {
  id: string;
  mag: number;
  loc: string;
  depth: number;
  time: string;
}

withDefaults(
  defineProps<{
    reports?: ReportItem[];
    activeId?: string;
  }>(),
  {
    reports: () => [
      { id: '1', mag: 7.2, loc: '15 km al Sureste de Acapulco, Gro', depth: 15, time: 'Hoy 14:28:10' },
      { id: '2', mag: 5.2, loc: '42 km al Suroeste de Ometepec, Gro', depth: 12, time: 'Hoy 11:15:22' },
      { id: '3', mag: 4.4, loc: '18 km al Noroeste de Matías Romero, Oax', depth: 85, time: 'Hoy 08:44:02' },
      { id: '4', mag: 4.1, loc: '36 km al Sur de Coalcomán, Mich', depth: 10, time: 'Ayer 22:19:40' },
    ],
    activeId: '1',
  }
);

defineEmits<{
  (e: 'select', report: ReportItem): void;
}>();

function getMagClass(mag: number) {
  if (mag >= 6.0) return 'mag-strong';
  if (mag >= 5.0) return 'mag-moderate';
  return 'mag-minor';
}
</script>

<style scoped>
.reports-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.badge-counter {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  font-weight: 700;
}
</style>
