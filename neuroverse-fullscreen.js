(function () {
  "use strict";

  const buttons = new Set();
  const root = document.documentElement;
  let listenersReady = false;

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
  }

  function viewportSize() {
    const viewport = window.visualViewport;
    return {
      width: Math.round(viewport?.width || window.innerWidth),
      height: Math.round(viewport?.height || window.innerHeight),
    };
  }

  function updateViewport() {
    const { width, height } = viewportSize();
    root.style.setProperty("--nv-viewport-width", `${width}px`);
    root.style.setProperty("--nv-viewport-height", `${height}px`);
    window.dispatchEvent(
      new CustomEvent("neuroverse:viewportchange", {
        detail: { width, height, fullscreen: Boolean(fullscreenElement()) },
      }),
    );
  }

  function targetFor(button) {
    const selector = button.dataset.fullscreenTarget;
    if (!selector || selector === "document") return root;
    return document.querySelector(selector) || root;
  }

  function canRequest(target) {
    return Boolean(target?.requestFullscreen || target?.webkitRequestFullscreen || target?.webkitRequestFullScreen);
  }

  function sync() {
    const active = Boolean(fullscreenElement());
    root.classList.toggle("nv-fullscreen-active", active);
    buttons.forEach((button) => {
      button.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
      button.setAttribute("aria-pressed", String(active));
      button.title = active ? "Exit fullscreen" : "Fullscreen";
    });
    updateViewport();

    // Browsers resize a fullscreen iframe at slightly different moments. These
    // two notifications let every existing canvas/ResizeObserver settle once.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 180);
  }

  async function request(target) {
    if (target.requestFullscreen) {
      try {
        await target.requestFullscreen({ navigationUI: "hide" });
      } catch (error) {
        if (error instanceof TypeError) await target.requestFullscreen();
        else throw error;
      }
      return;
    }
    const webkitRequest = target.webkitRequestFullscreen || target.webkitRequestFullScreen;
    await webkitRequest.call(target);
  }

  async function exit() {
    if (document.exitFullscreen) await document.exitFullscreen();
    else {
      const webkitExit = document.webkitExitFullscreen || document.webkitCancelFullScreen;
      if (webkitExit) await webkitExit.call(document);
    }
  }

  async function toggle(button) {
    try {
      if (fullscreenElement()) await exit();
      else await request(targetFor(button));
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent("neuroverse:fullscreenerror", {
          detail: { error },
        }),
      );
    }
  }

  function installGlobalListeners() {
    if (listenersReady) return;
    listenersReady = true;
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    window.addEventListener("resize", updateViewport, { passive: true });
    window.addEventListener("orientationchange", updateViewport, { passive: true });
    window.visualViewport?.addEventListener("resize", updateViewport, { passive: true });
  }

  function mount(button) {
    if (!button || button.dataset.fullscreenReady === "true") return;
    const target = targetFor(button);
    button.dataset.fullscreenReady = "true";
    buttons.add(button);

    if (!canRequest(target)) {
      button.hidden = true;
      return;
    }

    button.addEventListener("click", () => void toggle(button));
  }

  function mountAll() {
    installGlobalListeners();
    document.querySelectorAll("[data-neuroverse-fullscreen]").forEach(mount);
    sync();
  }

  window.NeuroVerseFullscreen = { mount, sync, updateViewport };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll, { once: true });
  } else {
    mountAll();
  }
})();
