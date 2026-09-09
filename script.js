(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function runIntro() {
    var heading = document.querySelector(".hero-name");
    var popup = document.querySelector(".popup-card");
    if (!heading) return;

    var alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem("keystoneIntroPlayed") === "1";
    } catch (e) {}

    if (reduceMotion || alreadyPlayed) {
      heading.classList.add("is-in");
      if (popup) popup.classList.add("is-in");
      return;
    }

    try {
      sessionStorage.setItem("keystoneIntroPlayed", "1");
    } catch (e) {}

    requestAnimationFrame(function () {
      heading.classList.add("is-in");
    });

    window.setTimeout(function () {
      if (popup) popup.classList.add("is-in");
    }, 550);
  }

  function initPopupTilt() {
    var card = document.querySelector(".popup-card");
    if (!card || reduceMotion) return;

    window.setTimeout(function () {
      card.style.transition = "transform 0.2s ease, box-shadow 0.3s ease";
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty("--rx", (py * -6) + "deg");
        card.style.setProperty("--ry", (px * 8) + "deg");
      });
      card.addEventListener("pointerleave", function () {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    }, 1450);
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
    runIntro();
    initPopupTilt();
    runAssembly();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
