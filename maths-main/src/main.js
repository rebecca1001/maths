// Fonts ship with the app (no requests to Google or any other third party)
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './style.css';
import { boot } from './game.js';

document.documentElement.dataset.world = 'winter';
boot();
