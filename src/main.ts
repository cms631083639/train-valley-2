import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { registerSprite } from './icons/registry';
import './styles/tailwind.css';
import { useAuthStore } from './stores/auth';

// 注入矢量图标雪橇（若改用 iconfont.cn 的 CDN symbol，删掉这一行并在 index.html 引入脚本）
registerSprite();

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

const app = createApp(App);
app.use(pinia);
app.use(router);

// 启动时用 HttpOnly Cookie 里的 RefreshToken 静默恢复登录态（失败则视为未登录）
useAuthStore().bootstrap();

app.mount('#app');
