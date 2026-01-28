// js/main.js
import { createMap } from './map.js';
import { buildSidebar } from './sidebarBuilder.js';
import { sidebarConfig } from './sidebarConfig.js';
import { setupSidebarRouting } from './router.js';
import { showSplashIfNeeded } from './splash.js';

const map = createMap('map');
const sidebar = buildSidebar(map, sidebarConfig);

setupSidebarRouting(sidebar, map, sidebarConfig);

showSplashIfNeeded();
