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
    var trace = document.querySelector(".trace");
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runCapture);
  } else {
    runCapture();
  }
})();
