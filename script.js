(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  function formatGBP(n) {
    return "£" + Math.round(n).toLocaleString("en-GB");
  }

  function runCapture() {
    var trace = document.querySelector(".capture .trace");
    var capture = document.querySelector(".capture");
    var numberEl = document.querySelector(".capture-number");
    if (!trace || !capture || !numberEl) return;

    var target = parseInt(numberEl.getAttribute("data-target"), 10) || 0;

    if (reduceMotion) {
      numberEl.textContent = formatGBP(target);
      trace.classList.add("is-armed");
      capture.classList.add("is-done");
      return;
    }

    numberEl.textContent = formatGBP(0);

    requestAnimationFrame(function () {
      trace.classList.add("is-armed");
    });

    var lineDuration = 1500;
    var countDuration = 1000;

    window.setTimeout(function () {
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min((ts - start) / countDuration, 1);
        var value = target * easeOutExpo(progress);
        numberEl.textContent = formatGBP(value);
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          numberEl.textContent = formatGBP(target);
          capture.classList.add("is-done");
        }
      }
      requestAnimationFrame(step);
    }, lineDuration - 200);
  }

  function runIntro(onDone) {
    var overlay = document.querySelector(".intro-overlay");
    if (!overlay) {
      onDone();
      return;
    }

    var alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem("keystoneIntroPlayed") === "1";
    } catch (e) {}

    if (reduceMotion || alreadyPlayed) {
      overlay.parentNode.removeChild(overlay);
      onDone();
      return;
    }

    try {
      sessionStorage.setItem("keystoneIntroPlayed", "1");
    } catch (e) {}

    var trace = overlay.querySelector(".trace");

    requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });

    window.setTimeout(function () {
      if (trace) trace.classList.add("is-armed");
    }, 550);

    window.setTimeout(function () {
      overlay.classList.add("is-hidden");
      onDone();
    }, 1500);

    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 2100);
  }

  function runAssembly() {
    var section = document.querySelector(".assembly");
    if (!section) return;

    var rail = section.querySelector(".rail");
    var fill = section.querySelector(".rail-fill");
    var pulse = section.querySelector(".rail-pulse");
    var nodes = Array.prototype.slice.call(section.querySelectorAll(".rail-node"));
    if (!rail || !fill || !nodes.length) return;

    if (reduceMotion) {
      fill.style.width = "100%";
      nodes.forEach(function (n) { n.classList.add("is-locked"); });
      return;
    }

    var n = nodes.length;
    var ticking = false;

    function update() {
      ticking = false;
      var rect = section.getBoundingClientRect();
      var vh = window.innerHeight;
      var total = rect.height + vh;
      var scrolled = vh - rect.top;
      var progress = Math.min(Math.max(scrolled / total, 0), 1);

      fill.style.width = (progress * 100).toFixed(1) + "%";
      pulse.style.left = (progress * 100).toFixed(1) + "%";
      rail.classList.toggle("is-progressing", progress > 0.01 && progress < 0.995);

      nodes.forEach(function (node, i) {
        var start = i / n;
        var end = (i + 0.65) / n;
        var local = (progress - start) / (end - start);
        local = Math.min(Math.max(local, 0), 1);
        node.style.setProperty("--lock", local.toFixed(3));
        node.classList.toggle("is-locked", local > 0.5);
      });
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  function init() {
    runIntro(runCapture);
    runAssembly();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
