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
    var nodes = section.querySelectorAll(".rail-node");
    if (!rail || !nodes.length) return;

    function play() {
      if (reduceMotion) {
        rail.classList.add("is-armed");
        nodes.forEach(function (n) { n.classList.add("is-locked"); });
        return;
      }

      rail.classList.add("is-armed");

      window.setTimeout(function () {
        nodes.forEach(function (n, i) {
          window.setTimeout(function () {
            n.classList.add("is-locked");
          }, i * 130);
        });

        window.setTimeout(function () {
          rail.classList.add("is-connected");
        }, nodes.length * 130 + 500);
      }, 500);
    }

    if (!("IntersectionObserver" in window)) {
      play();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            play();
            observer.disconnect();
          }
        });
      },
      { threshold: 0.4 }
    );

    observer.observe(section);
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
