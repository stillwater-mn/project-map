// js/splash.js
const KEY = 'stillwater_splash_v2';

function $(sel) {
  return document.querySelector(sel);
}

function openSplash() {
  const splash = $('#splash');
  if (!splash) return;

  splash.classList.remove('hidden');
  splash.setAttribute('aria-hidden', 'false');

  // focus the continue button 
  $('#splash-continue')?.focus?.();
}

function closeSplash() {
  const splash = $('#splash');
  if (!splash) return;

  splash.classList.add('hidden');
  splash.setAttribute('aria-hidden', 'true');
  localStorage.setItem(KEY, '1');
}

function wireSplashEventsOnce() {
  const splash = $('#splash');
  if (!splash || splash.__wired) return;
  splash.__wired = true;

  splash.addEventListener('click', (e) => {
    const t = e.target;
    if (!t) return;


    if (t.id === 'splash-continue') return closeSplash();

    const closeAttr = t.getAttribute?.('data-splash-close');
    if (closeAttr === '1') return closeSplash();
  });

  window.addEventListener('keydown', (e) => {
    const splashNow = $('#splash');
    const isOpen = splashNow && !splashNow.classList.contains('hidden');
    if (!isOpen) return;

    if (e.key === 'Escape') closeSplash();
  });
}

export function showSplashIfNeeded({ force = false } = {}) {

  const run = () => {
    wireSplashEventsOnce();

    if (force) {
      openSplash();
      return;
    }

    const alreadySeen = localStorage.getItem(KEY) === '1';
    if (alreadySeen) return;

    openSplash();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}
