import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { registerSprite } from './icons/registry';
import './styles/tailwind.css';

// 注入矢量图标雪橇（若改用 iconfont.cn 的 CDN symbol，删掉这一行并在 index.html 引入脚本）
registerSprite();

createApp(App).use(createPinia()).mount('#app');
