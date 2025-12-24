import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import App from '../App.vue';
import LinkRedirect from '../views/LinkRedirect.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    name: 'Home',
    component: App
  },
  {
    path: '/s/:code',
    name: 'LinkRedirect',
    component: LinkRedirect,
    props: true
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;