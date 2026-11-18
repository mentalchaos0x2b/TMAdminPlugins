import { createApp } from "vue";
import { createPinia } from "pinia";
import NetworkDemo from "./NetworkDemo.vue";
import "@/styles/base.css";

const app = createApp(NetworkDemo);
app.use(createPinia());
app.mount("#app");
