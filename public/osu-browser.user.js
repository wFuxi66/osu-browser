// ==UserScript==
// @name         osu!browser: edit from the beatmap page
// @namespace    https://osu-browser.vercel.app
// @version      1.0.0
// @description  Adds an "Edit in osu!browser" button next to Download on osu! beatmap pages.
// @match        https://osu.ppy.sh/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://osu-browser.vercel.app/osu-browser.user.js
// @updateURL    https://osu-browser.vercel.app/osu-browser.user.js
// ==/UserScript==

(() => {
  // Self-hosting osu!browser? Point this at your own address.
  const APP = 'https://osu-browser.vercel.app';
  const ID = 'osu-browser-edit';

  // osu!browser reads the same path as osu.ppy.sh, plus the hash with the difficulty picked here.
  const link = () => `${APP}${location.pathname.match(/^\/beatmapsets\/\d+/)[0]}${location.hash}`;

  function addButton() {
    if (!/^\/beatmapsets\/\d+/.test(location.pathname) || document.getElementById(ID)) return;
    const buttons = document.querySelector('.beatmapset-header__buttons');
    if (!buttons) return;
    const a = document.createElement('a');
    a.id = ID;
    a.className = 'btn-osu-big btn-osu-big--beatmapset-header';
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Open this difficulty in osu!browser';
    a.innerHTML =
      '<span class="btn-osu-big__content"><span class="btn-osu-big__left">' +
      '<span class="btn-osu-big__text-top">Edit</span><span class="btn-osu-big__text-bottom">in osu!browser</span>' +
      '</span><span class="btn-osu-big__icon"><span class="fa fa-fw"><span class="fas fa-pencil-alt"></span></span></span></span>';
    // The picked difficulty can change after the button is made, so the address is read when it's used.
    const update = () => (a.href = link());
    update();
    a.addEventListener('mousedown', update);
    a.addEventListener('focus', update);
    buttons.appendChild(a);
  }

  // osu-web swaps pages without reloading, so watch for the header showing up.
  new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
  addButton();
})();
