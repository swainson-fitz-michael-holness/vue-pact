import { createApp, ref, computed, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

createApp({
  setup() {
    const manifest = ref(null);
    const q = ref('');
    const selected = ref(null);

    onMounted(async () => {
      const res = await fetch('./vuepact.manifest.json');
      manifest.value = await res.json();
      selected.value = manifest.value.components[0] || null;
    });

    const filtered = computed(() => {
      if (!manifest.value) return [];
      const list = manifest.value.components;
      if (!q.value) return list;
      const s = q.value.toLowerCase();
      return list.filter(c =>
        c.name.toLowerCase().includes(s) || c.file.toLowerCase().includes(s)
      );
    });

    function pick(c) { selected.value = c; }

    return { manifest, q, filtered, selected, pick };
  },
  template: `
  <div v-if="!manifest" class="muted">Loading manifest…</div>
  <div v-else class="grid">
    <aside class="card">
      <h3 style="margin-top:0">Components</h3>
      <input type="search" v-model="q" placeholder="Search name or path" />
      <div style="margin-top:12px; max-height: 70vh; overflow: auto;">
        <div v-for="c in filtered" :key="c.file" @click="pick(c)" style="cursor:pointer; padding:6px 4px; border-radius:8px;" :style="{background:selected && selected.file===c.file?'#f6f6f6':''}">
          <div><strong>{{ c.name }}</strong></div>
          <div class="muted" style="font-size:12px">{{ c.file }}</div>
          <div style="margin-top:4px">
            <span class="pill">props {{ c.props.length }}</span>
            <span class="pill">emits {{ c.emits.length }}</span>
            <span class="pill">slots {{ c.slots.length }}</span>
          </div>
        </div>
      </div>
    </aside>

    <main v-if="selected" class="card">
      <h2 style="margin-top:0">{{ selected.name }}</h2>
      <div class="muted" style="font-size:12px">{{ selected.file }}</div>

      <h3>Metrics</h3>
      <div>
        <span class="pill">template lines {{ selected.metrics.templateLines }}</span>
        <span class="pill">script lines {{ selected.metrics.scriptLines }}</span>
        <span class="pill">branches {{ selected.metrics.branches }}</span>
        <span class="pill">cohesion {{ selected.metrics.cohesion }}</span>
      </div>

      <h3 v-if="selected.props.length">Props</h3>
      <table v-if="selected.props.length">
        <thead><tr><th>name</th><th>type</th><th>required</th><th>default</th><th>source</th></tr></thead>
        <tbody>
          <tr v-for="p in selected.props" :key="p.name">
            <td>{{ p.name }}</td><td>{{ p.type || '' }}</td><td>{{ p.required ? 'yes' : 'no' }}</td><td>{{ p.default || '' }}</td><td class="muted">{{ p.from }}</td>
          </tr>
        </tbody>
      </table>

      <h3>Emits</h3>
      <div v-if="selected.emits.length; else noneEmits">
        <span v-for="e in selected.emits" :key="e" class="pill">{{ e }}</span>
      </div>
      <template #noneEmits><div class="muted">(none)</div></template>

      <h3>Slots</h3>
      <div v-if="selected.slots.length; else noneSlots">
        <span v-for="s in selected.slots" :key="s" class="pill">{{ s }}</span>
      </div>
      <template #noneSlots><div class="muted">(none)</div></template>

      <h3 v-if="selected.warnings.length">Warnings</h3>
      <div v-if="selected.warnings.length" class="warn">
        <ul>
          <li v-for="(w,i) in selected.warnings" :key="i">[{{ w.rule }}] {{ w.message }}</li>
        </ul>
      </div>
    </main>
  </div>
  `
}).mount('#app');
