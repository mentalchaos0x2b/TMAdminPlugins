import { createApp } from "vue";
import { createPinia } from "pinia";
import Step14Demo from "./Step14Demo.vue";
import "@/styles/base.css";

const app = createApp(Step14Demo);
app.use(createPinia());
app.mount("#app");
