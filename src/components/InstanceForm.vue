<script setup lang="ts">
/** 物资实例 新增/编辑表单（弹窗） */
import { computed, reactive, ref, watch } from 'vue';
import type { ResourceInstance } from '@/types';

const props = defineProps<{
  /** 编辑时传原始值；新增时传 null */
  original: ResourceInstance | null;
  /** 已存在的实例ID 列表（用于校验不重复） */
  existingIds: string[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', data: ResourceInstance): void;
}>();

const isEdit = computed(() => !!props.original);

const form = reactive<ResourceInstance>({
  id: '',
  name: '',
  inputs: [],
  external: false,
  obtain: null,
  needsPower: false,
  perOut: 1,
  perIn: 1,
  notes: '',
});

watch(
  () => props.original,
  (v) => {
    if (v) Object.assign(form, JSON.parse(JSON.stringify(v)));
    else Object.assign(form, { id: '', name: '', inputs: [], external: false, obtain: null, needsPower: false, perOut: 1, perIn: 1, notes: '' });
  },
  { immediate: true },
);

const err = ref('');

function validate(): string {
  if (!form.id.trim()) return '实例ID不能为空';
  if (!form.name.trim()) return '物资名称不能为空';
  if (!isEdit.value && props.existingIds.includes(form.id)) return `实例ID「${form.id}」已存在`;
  if (isEdit.value && form.id !== props.original?.id && props.existingIds.includes(form.id)) return `实例ID「${form.id}」已存在`;
  if (form.external) {
    if (!form.obtain) return '外部获取实例必须选择获取方式';
  } else {
    if (!form.inputs.length) return '生产类实例必须有配方输入（至少"工人"）';
    if ((form.perOut ?? 0) <= 0) return '单次产出必须为正整数';
    if ((form.perIn ?? 0) <= 0) return '单次消耗必须为正整数';
  }
  return '';
}

function onSubmit() {
  const msg = validate();
  if (msg) { err.value = msg; return; }
  // 生产类强制清理外部字段；外部类强制清理生产字段
  const data: ResourceInstance = form.external
    ? { ...form, inputs: [], perOut: undefined, perIn: undefined }
    : { ...form, external: false, obtain: null };
  emit('submit', data);
}

function toggleObtain(v: '刷新' | '购买' | '无限') {
  form.obtain = form.obtain === v ? null : v;
}

function toggleInput(n: string) {
  const i = form.inputs.indexOf(n);
  if (i >= 0) form.inputs.splice(i, 1);
  else form.inputs.push(n);
}
</script>

<template>
  <!-- 遮罩 -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @mousedown.self="emit('close')">
    <div class="w-[520px] rounded-lg border border-ink-600 bg-ink-800 shadow-2xl">
      <!-- 标题 -->
      <div class="flex items-center justify-between border-b border-ink-600 px-5 py-3">
        <div class="text-sm font-semibold text-fog-100">
          {{ isEdit ? '✏️ 编辑物资实例' : '➕ 新增物资实例' }}
        </div>
        <button class="text-fog-400 hover:text-fog-100" @click="emit('close')">✕</button>
      </div>

      <!-- 表单主体 -->
      <div class="space-y-3 px-5 py-4 text-[12px]">
        <!-- 实例ID -->
        <div class="flex items-center gap-3">
          <label class="w-[84px] shrink-0 text-fog-400">实例ID</label>
          <input v-model="form.id" class="flex-1" placeholder="如：煤炭jI" :disabled="isEdit" :class="{ 'opacity-50 cursor-not-allowed': isEdit }" />
        </div>

        <!-- 物资名称 -->
        <div class="flex items-center gap-3">
          <label class="w-[84px] shrink-0 text-fog-400">物资名称</label>
          <input v-model="form.name" class="flex-1" placeholder="如：煤炭" />
        </div>

        <!-- 外部获取 / 电力依赖 开关 -->
        <div class="flex items-center gap-3">
          <label class="w-[84px] shrink-0 text-fog-400">属性</label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="form.external" class="accent-steel-brand" />
            <span>外部获取（无配方）</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer ml-3">
            <input type="checkbox" v-model="form.needsPower" class="accent-steel-brand" />
            <span>⚡ 需电力</span>
          </label>
        </div>

        <!-- 外部获取：获取方式 -->
        <div v-if="form.external" class="flex items-center gap-3">
          <label class="w-[84px] shrink-0 text-fog-400">获取方式</label>
          <div class="flex items-center gap-1">
            <button type="button"
              v-for="o in ['刷新', '购买', '无限'] as const" :key="o"
              class="rounded border px-2.5 py-0.5 text-[11px] transition-colors"
              :class="form.obtain === o
                ? 'border-steel-brand bg-steel-brand/15 text-steel-brand'
                : 'border-ink-500 text-fog-400 hover:border-steel-brand hover:text-fog-100'"
              @click="toggleObtain(o)">{{ o }}</button>
          </div>
        </div>

        <!-- 生产类：inputs + 单次产出/消耗 -->
        <template v-else>
          <div class="flex items-center gap-3">
            <label class="w-[84px] shrink-0 text-fog-400">配方输入</label>
            <div class="flex flex-wrap items-center gap-1">
              <button
                type="button"
                v-for="n in ['工人', '原木', '木板', '煤炭', '铁矿', '小麦', '砂土', '奶牛', '电力', '聚合物', '金属板', '管道', '燃料', '肥料', '玻璃', '家具', '石油', '钢铁', '铜', '铀', '合金', '炸药']"
                :key="n"
                class="rounded border px-2 py-0.5 text-[11px]"
                :class="form.inputs.includes(n)
                  ? 'border-steel-brand bg-steel-brand/15 text-steel-brand'
                  : 'border-ink-500 text-fog-400 hover:border-steel-brand hover:text-fog-100'"
                @click="toggleInput(n)"
              >{{ n }}</button>
              <span v-if="!form.inputs.length" class="text-[11px] text-fog-500">至少选「工人」</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <label class="w-[84px] shrink-0 text-fog-400">单次产出/消耗</label>
            <div class="flex items-center gap-2">
              <span>产出</span>
              <input v-model.number="form.perOut" type="number" min="1" step="1" class="w-16 text-center" />
              <span class="text-fog-500">·</span>
              <span>消耗</span>
              <input v-model.number="form.perIn" type="number" min="1" step="1" class="w-16 text-center" />
            </div>
          </div>
        </template>

        <!-- 备注 -->
        <div class="flex items-start gap-3">
          <label class="w-[84px] shrink-0 pt-1 text-fog-400">备注</label>
          <textarea v-model="form.notes" class="flex-1 min-h-[60px] resize-y rounded border border-ink-600 bg-ink-700 px-2.5 py-1.5 text-[12px] text-fog-100 outline-none focus:border-steel-brand" placeholder="选填：记号、用途说明等" />
        </div>

        <!-- 错误提示 -->
        <div v-if="err" class="rounded border border-bad/50 bg-bad/10 px-3 py-1.5 text-[11px] text-bad">
          ⚠️ {{ err }}
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="flex items-center justify-end gap-2 border-t border-ink-600 px-5 py-3">
        <button class="btn !px-3" @click="emit('close')">取消</button>
        <button class="btn !px-3 bg-amber-brand text-ink-900 hover:bg-amber-brand/80" @click="onSubmit">
          {{ isEdit ? '保存' : '新增' }}
        </button>
      </div>
    </div>
  </div>
</template>
